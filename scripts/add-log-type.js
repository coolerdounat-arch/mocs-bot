const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'src', 'data', 'log-types.csv');
const [command, logType, minimumRank = '50'] = process.argv.slice(2);
const supportedCommands = new Set(['log-ct', 'log-patrol', 'log-event', 'log-others']);
const rank = Number(minimumRank);

if (!supportedCommands.has(command) || !logType || !Number.isInteger(rank) || rank < 0 || logType.includes(',')) {
  console.error('Usage: npm run add:log-type -- <log-command> "<log type>" [minimum rank]');
  console.error('Example: npm run add:log-type -- log-event "Community Meeting" 110');
  process.exit(1);
}

const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
const row = `${command},${logType.trim()},${rank}`;
if (lines.slice(1).some((line) => line === row)) {
  console.log(`Log type already exists: ${logType.trim()}`);
  process.exit(0);
}

fs.writeFileSync(filePath, `${[...lines, row].join('\n')}\n`, 'utf8');
console.log(`Added ${logType.trim()} to /${command} with minimum rank ${rank}.`);