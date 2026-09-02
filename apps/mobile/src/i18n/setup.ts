import {
  createI18nFromBundles,
  localeBundles,
  resolveLocale
} from '@fast-ide/i18n/browser';
import { initReactI18next } from 'react-i18next';

import { systemTag } from './locale';

export const i18n = createI18nFromBundles(
  resolveLocale('system', systemTag()),
  localeBundles,
  (instance) => instance.use(initReactI18next)
);
