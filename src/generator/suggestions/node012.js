import { _ } from 'azk';
import { UIProxy } from 'azk/cli/ui';
import { example_system } from 'azk/generator/rules';

export class Suggestion extends UIProxy {
  constructor(...args) {
    super(...args);

    // Readable name for this suggestion
    this.name = 'node012';

    // Which rules they suggestion is valid
    this.ruleNamesList = ['node012'];

    // Initial Azkfile.js suggestion
    this.suggestion = _.extend({}, example_system, {
      __type: "node.js",
      image : { docker: "azukiapp/node:0.12" },
      provision: [
        "npm install"
      ],
      http: true,
      scalable: { default: 2 },
      command : "npm start",
      envs    : {
        NODE_ENV: "dev"
      }
    });
  }

  suggest() {
    return this.suggestion;
  }
}
