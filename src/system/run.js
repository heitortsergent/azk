import { _, async, config} from 'azk';
import docker from 'azk/docker';
import { ImageNotAvailable, SystemRunError, RunCommandError } from 'azk/utils/errors';
import net from 'azk/utils/net';

var MemoryStream = require('memorystream');

var Run = {

  runProvision(system, options = {}) {
    options = _.defaults(options, {
      provision_force: false,
    });

    return async(this, function* (notify) {
      var steps = system.provision_steps;

      if (_.isEmpty(steps)) return null;
      if ((!options.provision_force) && system.provisioned) return null;

      // provision command (require /bin/sh)
      var cmd  = ["/bin/sh", "-c", "( " + steps.join('; ') + " )"];

      // Capture outputs
      var output = "";
      options = _.clone(options);
      options.stdout = new MemoryStream();
      options.stdout.on('data', (data) => {
        output += data.toString();
      });

      notify({ type: "provision", system: system.name });
      var exitResult = yield system.runShell(cmd, options);
      if (exitResult.code != 0) {
        throw new RunCommandError(cmd.join(' '), output);
      }
      // save the date provisioning
      this.provisioned = new Date();
    });
  },

  runShell(system, command, options = {}) {
    options = _.defaults(options, {
      remove: false,
    });

    return async(this, function* () {
      yield this._check_image(system, options);
      var docker_opt = system.shellOptions(options);
      var container  = yield docker.run(system.image.name, command, docker_opt);
      var data       = yield container.inspect();

      // Remove before run
      if (options.remove) { yield container.remove(); }

      return {
        code: data.State.ExitCode,
        containerId: container.Id,
        removed: options.remove,
      }
    });
  },

  runDaemon(system, options = {}) {
    return async(this, function* (notify) {
      // TODO: add instances and dependencies options
      // TODO: support to wait udp protocol
      // Prepare options
      var image = yield this._check_image(system, options);
      options.image_data = image;

      // Check provision
      yield system.runProvision(options);

      var docker_opt = system.daemonOptions(options);
      var command    = docker_opt.command;
      var container  = yield docker.run(system.image.name, command, docker_opt);

      var data = yield container.inspect();
      var port_data = _.find(data.NetworkSettings.Access, (port) => {
        return port.protocol == 'tcp'
      });

      if (port_data) {
        var retry   = options.timeout || config('docker:run:retry');
        var timeout = options.retry   || config('docker:run:timeout');

        yield this._wait_available(system, port_data, container, retry, timeout);
      }

      return container;
    });
  },

  stop(system, instances, options = {}) {
    options = _.defaults(options, {
      kill: false,
      remove: true,
    });

    return async(function* (notify) {
      var container = null;

      // Default stop all
      if (_.isEmpty(instances)) {
        instances = yield system.instances();
      }

      while (container = instances.pop()) {
        container = docker.getContainer(container.Id);
        if (options.kill) {
          notify({ type: 'kill_service', system: system.name });
          yield container.kill();
        } else {
          notify({ type: 'stop_service', system: system.name });
          yield container.stop();
        }
        notify({ type: "stopped", id: container.Id });
        if (options.remove)
          yield container.remove();
      }

      return true;
    });
  },

  // Wait for container/system available
  _wait_available(system, port_data, container, retry, timeout) {
    return async(this, function* () {
      if (config('agent:requires_vm')) {
        var host = config('agent:vm:ip');
      } else {
        var host = port_data.gateway;
      }

      // Wait for available
      var wait_opts = {
        timeout: timeout,
        retry_if: () => {
          return container.inspect().then((data) => {
            //console.log(data);
            return data.State.Running;
          });
        },
      };

      var running = yield net.waitService(host, port_data.port, retry, wait_opts);

      if (!running) {
        var data = yield container.inspect();
        var log  = yield container.logs({stdout: true, stderr: true});
        throw new SystemRunError(
          system.name,
          container,
          data.Config.Cmd.join(' '),
          data.State.ExitCode,
          log
        );
      }

      return true;
    });
  },

  // Check and pull image
  _check_image(system, options) {
    options = _.defaults(options, {
      image_pull: true,
    });

    return async(function* () {
      if (options.image_pull) {
        var promise = system.image.pull();
      } else {
        var promise = system.image.check().then((image) => {
          if (image == null) {
            throw new ImageNotAvailable(system.name, system.image.name);
          }
          return image;
        });
      }

      var image = yield promise.progress((event) => {
        event.system = system;
        return event;
      });

      return image.inspect();
    });
  },
}

export { Run }