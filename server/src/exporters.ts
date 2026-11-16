import { type Entry, type ExportFile, FIELD_LABELS, TEXT_FIELDS, formatDateLong } from '../../shared/model.js';

export function toJson(entries: Entry[]): string {
  const file: ExportFile = {
    app: 'achievement-diary',
    version: 1,
    exported_at: new Date().toISOString(),
    entries,
  };
  return JSON.stringify(file, null, 2);
}

/** Читаемый Markdown, записи от старых к новым. */
export function toMarkdown(entries: Entry[]): string {
  const out: string[] = ['# Дневник достижений', ''];
  for (const e of entries) {
    out.push(`## ${formatDateLong(e.date)}`, '');
    if (e.category) out.push(`**${FIELD_LABELS.category}:** ${e.category}`, '');
    for (const key of TEXT_FIELDS) {
      const value = e[key];
      if (!value) continue;
      out.push(`**${FIELD_LABELS[key]}**`, '', value, '');
    }
  }
  return out.join('\n');
}

const CSV_COLUMNS = [
  'date', 'achievement', 'category', 'obstacle', 'how', 'lesson', 'goal_tomorrow', 'created_at', 'updated_at',
] as const;

function csvCell(v: string | null): string {
  if (v === null) return '';
  return /[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v;
}

/** CSV по RFC 4180, с BOM — чтобы Excel правильно открыл кириллицу. */
export function toCsv(entries: Entry[]): string {
  const rows = [CSV_COLUMNS.join(',')];
  for (const e of entries) rows.push(CSV_COLUMNS.map((c) => csvCell(e[c])).join(','));
  return '﻿' + rows.join('\r\n') + '\r\n';
}
