// 共有済みSessionのローカル編集を、R2側へ自動反映するための薄いラッパー。
//
// 競合の扱いは「後勝ち(last-write-wins)」。あとから届いた更新が前の値を上書きする。
// ただし上書きされるのは patch に含めたフィールドだけで、Worker側の applyPatch が
// ホワイトリストで受けるため、触っていない項目(他の人のコメントなど)は消えない。
//
// ShareModalの「更新をアップロード」が音声ごと丸ごと差し替えるのに対し、
// こちらは変更されたフィールドだけを送る差分更新。

import { updateSharedSession } from './remoteRepository.js';

/** このSessionが共有済みで、編集トークンを持っているか */
export function isSyncable(session) {
  return Boolean(session && session.syncStatus === 'shared' && session.shareId && session.shareEditToken);
}

/**
 * 共有済みSessionにパッチを送る。共有していないSessionでは何もしない。
 * ローカル保存は既に完了している前提なので、通信に失敗しても例外は投げず false を返す
 * (オフラインでもローカルの編集は成立させ、次の編集時に再度送られる)。
 */
export async function syncToShare(session, patch) {
  if (!isSyncable(session)) return null;
  try {
    await updateSharedSession(session.shareId, session.shareEditToken, patch);
    return true;
  } catch (err) {
    console.error('共有先への反映に失敗しました', err);
    return false;
  }
}
