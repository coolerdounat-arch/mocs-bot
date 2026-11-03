require('dotenv').config();
const fs = require('fs');
const { importLinkedUsers } = require('../src/services/linkedUsers');

function parseLine(line) {
  const fields = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      fields.push(value);
      value = '';
    } else {
      value += character;
    }
  }
  fields.push(value);
  return fields;
}

function readLegacyCsv(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter((line) => line.trim());
  const header = (lines.shift() || '').split(',').map((field) => field.trim());
  if (header[0] !== 'discord_id' || header[1] !== 'roblox_id' || header[2] !== 'roblox_username') {
    throw new Error('Legacy linked-user CSV has an unexpected header.');
  }
  return lines.map((line, index) => {
    const [discordId, robloxId, robloxUsername, linkStatus] = parseLine(line).map((value) => value.trim());
    if (!/^\d{17,20}$/.test(discordId) || !/^\d{1,20}$/.test(robloxId) || !robloxUsername) {
      throw new Error(`Invalid linked-user row ${index + 2}.`);
    }
    return { discordId, robloxId, robloxUsername, linkStatus: linkStatus || 'active' };
  });
}

function main() {
  const sourcePath = process.argv[2];
  if (!sourcePath) throw new Error('Usage: node scripts/migrate-linked-users.js /path/to/linked-users.csv');
  const records = readLegacyCsv(sourcePath);
  const imported = importLinkedUsers(records);
  console.log(`Imported ${imported} linked-user records into SQLite. The source CSV was left unchanged as a backup.`);
}

try {
  main();
} catch (error) {
  console.error(`Linked-user migration failed: ${error.message}`);
  process.exitCode = 1;
}
