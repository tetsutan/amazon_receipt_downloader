import { Fatal } from './util.mjs';

// 期は終わりの年で呼ぶ。2026 期 = 2025-11-01 〜 2026-10-31 (決算期が 11 月始まりのため)。
export function period(arg) {
  if (!/^\d{4}$/.test(arg ?? '')) throw new Fatal(`期を 4 桁の年で指定してください (例: 2026 → 2025-11-01〜2026-10-31): ${arg ?? ''}`, 2);
  const end = Number(arg);
  const from = `${end - 1}-11-01`;
  const to = `${end}-10-31`;
  return {
    name: arg,
    from,
    to,
    label: `${from}_${to}`,
    // Amazon の注文履歴は暦年でしか絞れないので、期にかかる 2 つの暦年を取る。
    years: [String(end - 1), String(end)],
    includes: (date) => !!date && date >= from && date <= to,
  };
}
