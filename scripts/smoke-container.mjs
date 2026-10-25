import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

// Run after: docker build -t family-cart:test .
// Tests the real non-root image without depending on host port forwarding.
const image = process.env.TEST_IMAGE || 'family-cart:test';
const suffix = randomUUID().slice(0, 8);
const name = `family-cart-check-${suffix}`;
const volume = `family-cart-check-data-${suffix}`;
let created = false;

function docker(...args) {
  const result = spawnSync('docker', args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || 'Docker command failed');
  return result.stdout.trim();
}
async function ready() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      docker('exec', name, 'node', '-e', "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))");
      return;
    } catch { await new Promise((resolve) => setTimeout(resolve, 150)); }
  }
  throw new Error('Container did not become ready');
}

try {
  docker('run', '-d', '--name', name, '-v', `${volume}:/app/data`, image);
  created = true;
  await ready();
  const token = docker('exec', name, 'node', '--input-type=module', '-e', `
    import { WebSocket } from 'ws';
    import { once } from 'node:events';
    const base = 'http://127.0.0.1:3000';
    const result = await fetch(base+'/api/lists', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'Container test'})});
    if(!result.ok) throw new Error('Create list failed');
    const list=await result.json();
    const ws=new WebSocket('ws://127.0.0.1:3000/live/'+list.token);
    await once(ws,'message');
    const live=once(ws,'message');
    const saved=await fetch(base+'/api/lists/'+list.token+'/items',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Persisted milk',store:'Costco'})});
    if(!saved.ok) throw new Error('Save item failed');
    const [message]=await live;
    if(JSON.parse(message).items[0].name!=='Persisted milk') throw new Error('Live sync failed');
    ws.close();await once(ws,'close');
    const shell=await fetch(base+'/l/'+list.token);
    const html=await shell.text();
    if(!shell.ok || !html.includes('Family Cart')) throw new Error('Frontend failed');
    const script=html.match(/<script[^>]+src="([^"]+)"/)[1];
    for(const asset of [script,'/icon-192.png','/manifest.webmanifest']) {
      if(!(await fetch(base+asset)).ok) throw new Error('Asset unavailable: '+asset);
    }
    console.log(list.token);
  `);
  docker('restart', name);
  await ready();
  docker('exec', name, 'node', '--input-type=module', '-e', `
    const result=await fetch('http://127.0.0.1:3000/api/lists/'+process.argv[1]);
    const list=await result.json();
    if(list.items[0]?.name!=='Persisted milk') throw new Error('Restart lost data');
  `, token);
  console.log('Container passed: frontend assets, API, live sync, non-root database writes, and restart persistence.');
} catch (error) {
  if (created) {
    const logs = spawnSync('docker', ['logs', name], { encoding: 'utf8' });
    console.error(logs.stdout, logs.stderr);
  }
  throw error;
} finally {
  if (created) docker('rm', '-f', name);
  try { docker('volume', 'rm', volume); } catch { /* A failed creation may not create a volume. */ }
}
