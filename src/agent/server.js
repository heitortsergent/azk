import { config, Q, defer, async, log } from 'azk';
import { app }   from 'azk/agent/app';
import { VM  }   from 'azk/agent/vm';
import { Unfsd } from 'azk/agent/unfsd';

var Server = {
  server: null,
  vm_started: false,

  start() {
    var self = this;
    return Q.async(function* () {
      log.info_t("commands.agent.starting");

      // Virtual machine is required?
      if (config('agent:requires_vm')) {
        yield self.installShare();
        yield self.installVM(true);
      }

      // Load balancer
      //self.installBalancer();

      // Start web api
      var socket  = config('paths:agent_socket');
      self.server = app.listen(socket);
      log.info_t("commands.agent.started", socket);

      return defer(() => {});
    })();
  },

  stop() {
    var self = this;
    return Q.async(function* () {
      //if (self.vm_started) {
        yield self.stopVM();
      //}
      yield self.removeShare();

      if (self.server) {
        // Stop service
        yield Q.ninvoke(self.server, "close");
      } else {
        return Q.reject("Server not running");
      }
    })();
  },

  installShare() {
    return Unfsd.start();
  },

  removeShare() {
    return Unfsd.stop();
  },

  installVM(start = false, progress = () => {}) {
    var self = this;
    var vm_name = config("agent:vm:name");
    return Q.async(function* () {
      var installed = yield VM.isInstalled(vm_name);
      var running   = (installed) ? yield VM.isRunnig(vm_name) : false;

      if (!installed) {
        var opts = {
          name: vm_name,
          ip  : config("agent:vm:ip"),
          boot: config("agent:vm:boot_disk"),
          data: config("agent:vm:data_disk"),
        }

        yield VM.init(opts);
      }

      if (!running && start) {
        yield VM.start(vm_name);
        self.vm_started = true;
        yield VM.configureIp(vm_name, config("agent:vm:ip")).progress(progress);
      };
    })();
  },

  stopVM(running) {
    var vm_name = config("agent:vm:name");
    return async(function* () {
      running = (running == null) ? (yield VM.isRunnig(vm_name)) : false;
      if (running) {
        yield VM.stop(vm_name);
      }
    });
  },
}

export { Server };
