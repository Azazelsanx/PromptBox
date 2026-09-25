'use strict';

const chalk = require('chalk');
const { handler } = require('../action-runner');

function register(program) {
  program
    .command('status')
    .description('Check whether PromptBox is reachable through the local CLI bridge (run this first).')
    .addHelpText(
      'after',
      '\nExamples:\n' +
        '  $ ai-gist status\n' +
        '  $ ai-gist status --json\n'
    )
    .action(
      handler(() => ({
        action: 'system.ping',
        humanFormatter: () => chalk.green('PromptBox is reachable.'),
      }))
    );
}

module.exports = { register };
