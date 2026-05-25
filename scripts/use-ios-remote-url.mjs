import { readFile, writeFile } from 'node:fs/promises';

const nativeConfigUrl = new URL('../ios/App/App/capacitor.config.json', import.meta.url);
const remoteUrl = process.env.RUNLOOP_IOS_DEV_URL || 'https://runloop-jet.vercel.app';

const config = JSON.parse(await readFile(nativeConfigUrl, 'utf8'));

config.server = {
  ...(config.server || {}),
  url: remoteUrl,
  cleartext: false
};

await writeFile(nativeConfigUrl, `${JSON.stringify(config, null, '\t')}\n`);
console.log(`iOS dev build will load ${remoteUrl}`);
