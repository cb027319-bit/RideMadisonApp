import assert from 'node:assert/strict';
import { test } from 'node:test';
import { t } from '../src/lib/i18n';
test('t works in node', () => { assert.equal(t('common.cancel'), 'Cancel'); });
