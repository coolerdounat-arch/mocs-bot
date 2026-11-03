const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPOSITORY_URL = 'https://github.com/coolerdounat-arch/mocs-bot.git';
const BRANCH = 'main';
const BOT_DIRECTORY = '/opt/discord-bot';
const STAGING_DIRECTORY = '/opt/discord-bot.update-staging';
const NODE_DIRECTORY = path.dirname(process.execPath);
const env = {
  ...process.env,
  PATH: `${NODE_DIRECTORY}:${process.env.PATH || '/usr/local/bin:/usr/bin:/bin'}`,
};

function run(command, args, cwd) {
  execFileSync(command, args, { cwd, env, stdio: 'inherit' });
}

function ensureSafePaths() {
  if (path.resolve(BOT_DIRECTORY) !== '/opt/discord-bot'
    || path.resolve(STAGING_DIRECTORY) !== '/opt/discord-bot.update-staging') {
    throw new Error('Updater paths did not match the configured deployment paths.');
  }
}

function prepareRelease() {
  ensureSafePaths();
  if (!fs.existsSync(path.join(BOT_DIRECTORY, '.env'))) {
    throw new Error('The live bot .env file is missing; refusing to stage an update.');
  }

  const stagingInfo = fs.lstatSync(STAGING_DIRECTORY);
  if (!stagingInfo.isDirectory() || stagingInfo.isSymbolicLink() || fs.readdirSync(STAGING_DIRECTORY).length) {
    throw new Error('The staging path must be an empty, real directory.');
  }
  run('git', ['clone', '--depth', '1', '--branch', BRANCH, REPOSITORY_URL, STAGING_DIRECTORY], BOT_DIRECTORY);

  const stagedEnvironmentPath = path.join(STAGING_DIRECTORY, '.env');
  fs.copyFileSync(path.join(BOT_DIRECTORY, '.env'), stagedEnvironmentPath);
  fs.chmodSync(stagedEnvironmentPath, 0o600);
  const credentialsPath = path.join(BOT_DIRECTORY, 'google-service-account.json');
  if (fs.existsSync(credentialsPath)) {
    const stagedCredentialsPath = path.join(STAGING_DIRECTORY, 'google-service-account.json');
    fs.copyFileSync(credentialsPath, stagedCredentialsPath);
    fs.chmodSync(stagedCredentialsPath, 0o600);
  }

  run('npm', ['ci'], STAGING_DIRECTORY);
  run('npm', ['test'], STAGING_DIRECTORY);
}

function deployCommands(directory) {
  ensureSafePaths();
  const target = path.resolve(directory);
  if (target !== BOT_DIRECTORY && target !== STAGING_DIRECTORY) {
    throw new Error('Refusing to deploy commands from an unexpected directory.');
  }
  run('npm', ['run', 'deploy'], target);
}

const action = process.argv[2];
if (action === 'prepare') {
  prepareRelease();
} else if (action === 'deploy-current') {
  deployCommands(BOT_DIRECTORY);
} else if (action === 'deploy-rollback') {
  deployCommands(process.argv[3]);
} else {
  throw new Error('Expected prepare, deploy-current, or deploy-rollback.');
}
