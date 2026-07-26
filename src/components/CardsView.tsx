'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, dayLabel, daysUntil, del, money, patch, post } from '@/lib/client';
import type { ApiBill, ApiCard, ApiStatement } from '@/lib/types';

export default function CardsView() {
  const [cards, setCards] = useState<ApiCard[]>([]);
  const [bills, setBills] = useState<ApiBill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ApiCard | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cardData, billData] = await Promise.all([
        api<{ cards: ApiCard[] }>('/api/cards'),
        api<{ bills: ApiBill[] }>('/api/statements?unpaid=1&withinDays=60'),
      ]);
      setCards(cardData.cards);
      setBills(billData.bills);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '載入失敗');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveAmount(statement: ApiStatement, amount: number) {
    await patch(`/api/statements/${statement.id}`, { amount });
    await load();
  }

  async function togglePaid(statement: ApiStatement) {
    await patch(`/api/statements/${statement.id}`, { paid: !statement.paid });
    await load();
  }

  async function removeCard(card: ApiCard) {
    if (!window.confirm(`刪除「${card.name}」？相關帳單與行事曆提醒都會一起移除。`)) return;
    await del(`/api/cards/${card.id}`);
    await load();
  }

  // A card can have several future statements queued up at once; only the
  // soonest due one per card is actionable, so that's all the countdown
  // list needs to show. `bills` is already sorted by dueAt ascending.
  const nearestPerCard = Array.from(
    bills
      .reduce((map, bill) => {
        if (!map.has(bill.cardId)) map.set(bill.cardId, bill);
        return map;
      }, new Map<string, (typeof bills)[number]>())
      .values(),
  );
  const totalDue = nearestPerCard.reduce((sum, bill) => sum + (bill.amount ?? 0), 0);

  return (
    <main>
      <header className="topbar">
        <h1>
          信用卡
          <span className="sub">
            {nearestPerCard.length > 0
              ? `${nearestPerCard.length} 筆未繳・合計 ${money(totalDue)}`
              : '目前沒有未繳帳單'}
          </span>
        </h1>
        <button className="btn sm primary" onClick={() => setAdding(true)}>
          ＋ 新增
        </button>
      </header>

      {error && <div className="alert danger">{error}</div>}
      {loading && <div className="empty">載入中…</div>}

      {!loading && nearestPerCard.length > 0 && (
        <div className="card">
          <h2>⏰ 繳費倒數</h2>
          <div className="stack">
            {nearestPerCard.map((bill) => {
              const tone = bill.overdue ? 'danger' : bill.daysLeft <= 3 ? 'warn' : 'ok';
              return (
                <div className="row spread" key={bill.id}>
                  <div className="grow">
                    <div className="row" style={{ gap: 6 }}>
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 999,
                          background: bill.color,
                          flex: '0 0 auto',
                        }}
                      />
                      <span className="small" style={{ fontWeight: 560 }}>
                        {bill.card}
                      </span>
                      {bill.autoPay && <span className="badge tiny">自動扣繳</span>}
                    </div>
                    <div className="tiny faint">
                      {bill.period} 期・{dayLabel(bill.dueAt)}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="amount small">{money(bill.amount)}</div>
                    <span className={`badge ${tone} tiny`}>
                      {bill.overdue
                        ? `逾期 ${Math.abs(bill.daysLeft)} 天`
                        : bill.daysLeft === 0
                          ? '今天到期'
                          : `還有 ${bill.daysLeft} 天`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!loading && cards.length === 0 && (
        <div className="card">
          <div className="empty">
            還沒有任何卡片。
            <br />
            新增一張後，系統會自動把每期繳款日排進行事曆並發 LINE 提醒。
          </div>
        </div>
      )}

      {cards.map((card) => (
        <CardBlock
          key={card.id}
          card={card}
          onEdit={() => setEditing(card)}
          onDelete={() => void removeCard(card)}
          onSaveAmount={saveAmount}
          onTogglePaid={togglePaid}
        />
      ))}

      {(adding || editing) && (
        <CardSheet
          card={editing}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSaved={async () => {
            setAdding(false);
            setEditing(null);
            await load();
          }}
        />
      )}
    </main>
  );
}

function CardBlock({
  card,
  onEdit,
  onDelete,
  onSaveAmount,
  onTogglePaid,
}: {
  card: ApiCard;
  onEdit: () => void;
  onDelete: () => void;
  onSaveAmount: (statement: ApiStatement, amount: number) => Promise<void>;
  onTogglePaid: (statement: ApiStatement) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  // Urgency order: unpaid soonest-first (what needs action), then settled
  // history newest-first. Sorting by period alone would bury the imminent bill
  // under statements that have not even closed yet.
  const visible = card.statements
    .slice()
    .sort((a, b) => {
      if (a.paid !== b.paid) return a.paid ? 1 : -1;
      return a.paid
        ? b.dueAt.localeCompare(a.dueAt)
        : a.dueAt.localeCompare(b.dueAt);
    })
    .slice(0, expanded ? 12 : 3);

  return (
    <div className="card" style={{ borderLeft: `3px solid ${card.color}` }}>
      <h2>
        <span className="row" style={{ gap: 6 }}>
          {card.name}
          {card.last4 && <span className="tiny faint">•••• {card.last4}</span>}
          {!card.active && <span className="badge tiny">已停用</span>}
        </span>
        <span className="row" style={{ gap: 6 }}>
          <button className="btn sm ghost" onClick={onEdit}>
            設定
          </button>
          <button className="btn sm danger" onClick={onDelete}>
            刪除
          </button>
        </span>
      </h2>

      <div className="tiny faint" style={{ marginBottom: 8 }}>
        每月 {card.statementDay} 日結帳・{card.dueNextMonth ? '次月' : '當月'} {card.dueDay} 日繳費
        {card.autoPay ? '・自動扣繳' : ''}・提醒：前 {card.remindDaysBefore.join('/')} 天
      </div>

      <div className="stack">
        {visible.map((statement) => (
          <StatementRow
            key={statement.id}
            statement={statement}
            onSaveAmount={onSaveAmount}
            onTogglePaid={onTogglePaid}
          />
        ))}
      </div>

      {card.statements.length > 3 && (
        <button
          className="btn sm ghost block"
          style={{ marginTop: 8 }}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? '收起' : '看更多期數'}
        </button>
      )}
    </div>
  );
}

function StatementRow({
  statement,
  onSaveAmount,
  onTogglePaid,
}: {
  statement: ApiStatement;
  onSaveAmount: (statement: ApiStatement, amount: number) => Promise<void>;
  onTogglePaid: (statement: ApiStatement) => Promise<void>;
}) {
  const [draft, setDraft] = useState(statement.amount === null ? '' : String(statement.amount));
  const [busy, setBusy] = useState(false);
  const left = daysUntil(statement.dueAt);
  const dirty = draft !== (statement.amount === null ? '' : String(statement.amount));

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="item">
      <button
        className="check"
        data-done={statement.paid}
        disabled={busy}
        onClick={() => void run(() => onTogglePaid(statement))}
        aria-label={statement.paid ? '改為未繳' : '標記已繳'}
      >
        ✓
      </button>
      <div className="grow">
        <div className="row" style={{ gap: 6 }}>
          <span className="small" style={{ fontWeight: 560 }}>
            {statement.period}
          </span>
          {statement.paid ? (
            <span className="badge ok tiny">已繳</span>
          ) : left < 0 ? (
            <span className="badge danger tiny">逾期 {Math.abs(left)} 天</span>
          ) : left <= 7 ? (
            <span className="badge warn tiny">還有 {left} 天</span>
          ) : null}
        </div>
        <div className="meta">繳款日 {dayLabel(statement.dueAt)}</div>
        {statement.trackedSpend > 0 && statement.trackedSpend !== statement.amount && (
          <button
            type="button"
            className="tiny faint"
            style={{ background: 'none', border: 0, padding: 0, textDecoration: 'underline', cursor: 'pointer' }}
            onClick={() => setDraft(String(statement.trackedSpend))}
          >
            已記消費 {money(statement.trackedSpend)}（點擊帶入，帳單可能還有利息或手續費，記得核對）
          </button>
        )}
      </div>
      <div className="row" style={{ gap: 4, flex: '0 0 auto' }}>
        <input
          className="mono"
          style={{ width: 96, padding: '5px 8px', fontSize: '0.82rem', textAlign: 'right' }}
          inputMode="decimal"
          placeholder="金額"
          value={draft}
          onChange={(changeEvent) => setDraft(changeEvent.target.value)}
        />
        {dirty && (
          <button
            className="btn sm primary"
            disabled={busy}
            onClick={() => {
              const amount = Number(draft);
              if (!Number.isFinite(amount) || amount < 0) return;
              void run(() => onSaveAmount(statement, amount));
            }}
          >
            存
          </button>
        )}
      </div>
    </div>
  );
}

const REMIND_PRESETS = [14, 7, 5, 3, 1, 0];

function CardSheet({
  card,
  onClose,
  onSaved,
}: {
  card: ApiCard | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(card?.name ?? '');
  const [last4, setLast4] = useState(card?.last4 ?? '');
  const [statementDay, setStatementDay] = useState(String(card?.statementDay ?? 15));
  const [dueDay, setDueDay] = useState(String(card?.dueDay ?? 5));
  const [dueNextMonth, setDueNextMonth] = useState(card?.dueNextMonth ?? true);
  const [autoPay, setAutoPay] = useState(card?.autoPay ?? false);
  const [active, setActive] = useState(card?.active ?? true);
  const [color, setColor] = useState(card?.color ?? '#6d8cff');
  const [remind, setRemind] = useState<number[]>(card?.remindDaysBefore ?? [7, 3, 1, 0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      name: name.trim(),
      last4: last4.trim() || null,
      statementDay: Number(statementDay),
      dueDay: Number(dueDay),
      dueNextMonth,
      autoPay,
      color,
      remindDaysBefore: remind,
      ...(card ? { active } : {}),
    };
    try {
      if (card) await patch(`/api/cards/${card.id}`, body);
      else await post('/api/cards', body);
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '儲存失敗');
      setBusy(false);
    }
  }

  return (
    <div
      className="sheet-backdrop"
      onClick={(clickEvent) => {
        if (clickEvent.target === clickEvent.currentTarget) onClose();
      }}
    >
      <form className="sheet" onSubmit={submit}>
        <h2>{card ? `編輯 ${card.name}` : '新增卡片'}</h2>

        <label className="field" htmlFor="card-name">
          卡片名稱
        </label>
        <input
          id="card-name"
          value={name}
          autoFocus={!card}
          placeholder="例如：國泰 CUBE"
          onChange={(changeEvent) => setName(changeEvent.target.value)}
        />

        <div className="grid2" style={{ marginTop: 10 }}>
          <div>
            <label className="field" htmlFor="card-statement-day">
              每月結帳日
            </label>
            <input
              id="card-statement-day"
              type="number"
              min={1}
              max={31}
              value={statementDay}
              onChange={(changeEvent) => setStatementDay(changeEvent.target.value)}
            />
          </div>
          <div>
            <label className="field" htmlFor="card-due-day">
              繳款截止日
            </label>
            <input
              id="card-due-day"
              type="number"
              min={1}
              max={31}
              value={dueDay}
              onChange={(changeEvent) => setDueDay(changeEvent.target.value)}
            />
          </div>
        </div>

        <div className="grid2" style={{ marginTop: 10 }}>
          <div>
            <label className="field" htmlFor="card-last4">
              末四碼（可留空）
            </label>
            <input
              id="card-last4"
              inputMode="numeric"
              maxLength={4}
              value={last4}
              onChange={(changeEvent) => setLast4(changeEvent.target.value)}
            />
          </div>
          <div>
            <label className="field" htmlFor="card-color">
              顏色
            </label>
            <input
              id="card-color"
              type="color"
              value={color}
              style={{ height: 42, padding: 4 }}
              onChange={(changeEvent) => setColor(changeEvent.target.value)}
            />
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <span className="field">繳款日落在</span>
          <div className="chips">
            <button
              type="button"
              className="chip"
              data-active={dueNextMonth}
              onClick={() => setDueNextMonth(true)}
            >
              結帳的次月
            </button>
            <button
              type="button"
              className="chip"
              data-active={!dueNextMonth}
              onClick={() => setDueNextMonth(false)}
            >
              結帳的當月
            </button>
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <span className="field">提醒時間（到期前幾天，可多選）</span>
          <div className="chips">
            {REMIND_PRESETS.map((days) => (
              <button
                type="button"
                key={days}
                className="chip"
                data-active={remind.includes(days)}
                onClick={() =>
                  setRemind((current) =>
                    current.includes(days)
                      ? current.filter((value) => value !== days)
                      : [...current, days].sort((a, b) => b - a),
                  )
                }
              >
                {days === 0 ? '當天' : `${days} 天前`}
              </button>
            ))}
          </div>
        </div>

        <div className="row wrap" style={{ marginTop: 14, gap: 14 }}>
          <label className="row small" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={autoPay}
              style={{ width: 18, height: 18 }}
              onChange={(changeEvent) => setAutoPay(changeEvent.target.checked)}
            />
            已設定自動扣繳
          </label>
          {card && (
            <label className="row small" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={active}
                style={{ width: 18, height: 18 }}
                onChange={(changeEvent) => setActive(changeEvent.target.checked)}
              />
              啟用中
            </label>
          )}
        </div>

        {error && (
          <div className="alert danger" style={{ marginTop: 10 }}>
            {error}
          </div>
        )}

        <div className="row" style={{ marginTop: 14 }}>
          <button type="button" className="btn ghost grow" onClick={onClose}>
            取消
          </button>
          <button
            type="submit"
            className="btn primary grow"
            disabled={busy || name.trim().length === 0}
          >
            {busy ? <span className="spinner" /> : '儲存'}
          </button>
        </div>
      </form>
    </div>
  );
}
