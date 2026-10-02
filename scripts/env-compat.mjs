/** Preserve existing deployment settings; explicitly set ARCBASE_* values win. */
export function normalizeEnvironment(environment = process.env) {
  for (const [name, value] of Object.entries(environment)) {
    if (!name.startsWith('ZENITH_')) continue;
    const next = `ARCBASE_${name.slice('ZENITH_'.length)}`;
    if (!Object.hasOwn(environment, next)) environment[next] = value;
  }
  return environment;
}
