import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createI18nFromBundles, localeBundles, resolveLocale } from '@fast-ide/i18n';

import { applyLocale, canFollowSystem } from './locale-boot.ts';

test('canFollowSystem ignores AppState until the saved pref is loaded', () => {
  assert.equal(canFollowSystem(false, 'system'), false);
  assert.equal(canFollowSystem(false, 'en'), false);
  assert.equal(canFollowSystem(true, 'en'), false);
  assert.equal(canFollowSystem(true, 'system'), true);
});

test('late system follow must not overwrite a pinned pref (restart bug)', () => {
  let language = resolveLocale('system', 'zh-CN');
  const apply = (hydrated: boolean, pref: Parameters<typeof resolveLocale>[0]) => {
    if (pref !== 'system' || canFollowSystem(hydrated, pref)) {
      language = resolveLocale(pref, 'zh-CN');
    }
  };

  let hydrated = false;
  let pref: Parameters<typeof resolveLocale>[0] = 'system';
  apply(hydrated, 'system');
  assert.equal(language, 'zh-CN');

  pref = 'en';
  apply(hydrated, pref);
  hydrated = true;
  apply(hydrated, pref);
  assert.equal(language, 'en');
});

test('applyLocale waits for init then pins en over a zh-CN boot', async () => {
  const instance = createI18nFromBundles('zh-CN', localeBundles);
  const resolved = await applyLocale(instance, 'en', 'zh-CN');
  assert.equal(resolved, 'en');
  assert.equal(instance.resolvedLanguage, 'en');
});
