const { readJson } = require('./osv-result-policy.cjs');
function inventory(file) {
  const lock = readJson(file);
  if (!lock.packages || typeof lock.packages !== 'object' || Array.isArray(lock.packages)) throw new Error('Missing npm inventory.');
  return Object.entries(lock.packages).map(([location, pkg]) => {
    if (!pkg || typeof pkg !== 'object' || (pkg.license !== undefined && typeof pkg.license !== 'string')) throw new Error('Invalid npm license record.');
    return { source: 'npm-lock', location, name: pkg.name || location.replace(/^.*node_modules\//, ''), version: pkg.version || '', license: pkg.license || '' };
  });
}
if (require.main === module) {
  try { console.log(JSON.stringify(inventory(process.argv[2]))); }
  catch { console.error('Incomplete npm license inventory.'); process.exitCode = 2; }
}
module.exports = { inventory };
