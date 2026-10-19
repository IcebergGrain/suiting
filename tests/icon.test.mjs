import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const resource = name => readFile(new URL('../android/app/src/main/res/' + name, import.meta.url), 'utf8');
const svg = () => readFile(new URL('../public/icon.svg', import.meta.url), 'utf8');
const paths = source => [...source.matchAll(/(?:android:pathData| d)="([^"]+)"/g)].map(match => match[1]);

test('public icon is a self-contained vector with an accessible name and a distinct playback label', async () => {
  const source = await svg();
  assert.match(source, /viewBox="0 0 64 64"/);
  assert.match(source, /aria-label="随听"/);
  assert.equal(paths(source).length, 6);
  assert.match(source, /M29.5,27.5L37,32L29.5,36.5Z/);
  assert.doesNotMatch(source, /<image|<script|href=|filter=|linearGradient/);
});

test('web and adaptive Android foreground preserve the exact same mark paths and palette', async () => {
  const source = await svg();
  const foreground = await resource('drawable/ic_launcher_foreground.xml');
  assert.deepEqual(paths(foreground), paths(source));
  for (const color of ['#122C1D', '#E8F2EB', '#739A83', '#B4DCBD']) {
    assert.ok(source.includes(color) && foreground.includes(color));
  }
});

test('Android uses adaptive masks with a monochrome drawable and no baked foreground background', async () => {
  const manifest = await readFile(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
  const adaptive = await resource('mipmap-anydpi/ic_launcher.xml');
  const foreground = await resource('drawable/ic_launcher_foreground.xml');
  assert.match(manifest, /android:icon="@mipmap\/ic_launcher"/);
  assert.match(manifest, /android:roundIcon="@mipmap\/ic_launcher"/);
  assert.match(adaptive, /@color\/launcher_background/);
  assert.match(adaptive, /@drawable\/ic_launcher_foreground/);
  assert.match(adaptive, /@drawable\/ic_launcher_monochrome/);
  assert.doesNotMatch(foreground, /#234D3C/);
  const mono = await resource('drawable/ic_launcher_monochrome.xml');
  assert.match(mono, /fillType="evenOdd"/);
  assert.doesNotMatch(mono, /#234D3C|#122C1D/);
});

test('adaptive foreground fits the central 66dp safe region and retains a filled playback label', async () => {
  const foreground = await resource('drawable/ic_launcher_foreground.xml');
  const scale = Number(foreground.match(/android:scaleX="([^"]+)"/)[1]);
  const translation = Number(foreground.match(/android:translateX="([^"]+)"/)[1]);
  const center = 32 * scale + translation;
  const radius = 22.5 * scale;
  assert.equal(center, 54);
  assert.ok(center - radius >= 21 && center + radius <= 87);
  assert.match(foreground, /android:fillColor="#B4DCBD" android:pathData="M32,23.5/);
});
