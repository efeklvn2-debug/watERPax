# Plan: Global Date Fields for Transaction Forms

## Context

Every transaction form in watERPax should have a date picker pre-filled with today's local date, so users can backdate entries (catch up on yesterday's transactions, etc.). The period lock (`Settings.booksLockedUntil`) prevents posting to closed periods, maintaining accounting integrity.

FlexoPrint ERP has this pattern consistently via `todayLocal()` from `utils/dates`. watERPax has the utility but doesn't use it everywhere.

**Key utility:** `apps/frontend/src/utils/dates.ts` exports `todayLocal()` (returns `YYYY-MM-DD` in local timezone) and `dateInputLocal(d)`.

## Issues Found (6 total)

| # | File | Line | Issue | Backend accepts `date`? |
|---|------|------|-------|--------------------------|
| 1 | `ProcurementPage.tsx` | 153 | `doPay` uses `new Date().toISOString().split('T')[0]` (UTC, not local) | Yes |
| 2 | `ProcurementPage.tsx` | 286 | Receive button pre-fills invoice date with UTC pattern | Yes |
| 3 | `ProcurementPage.tsx` | 347-362 | Supplier payment form has NO date input — date hardcoded | Yes |
| 4 | `SalesPage.tsx` | 98-108 | Customer payment form has NO date input | Yes (`recordPaymentSchema:37`) |
| 5 | `ProductionPage.tsx` | 87-97 | Production completion form has NO date input | Yes (`completeRunSchema:20`) |
| 6 | `InventoryPage.tsx` | 79-88 + backend `service.ts:127` | Stock adjustment has NO date input AND backend hardcodes `new Date().toISOString().split('T')[0]` | **No** — needs backend change |

## Files to Change (5 frontend + 1 backend)

### 1. `apps/frontend/src/pages/ProcurementPage.tsx`

**Import:** Add `import { todayLocal } from '../utils/dates'`

**State:** Add `const [payDate, setPayDate] = useState(todayLocal())` alongside existing pay state (~line 56)

**Fix line 153 (`doPay`):**
```ts
// BEFORE:
date: new Date().toISOString().split('T')[0],

// AFTER:
date: payDate,
```

**Fix line 286 (receive button onClick):**
```ts
// BEFORE:
setReceiveInvDate(new Date().toISOString().split('T')[0])

// AFTER:
setReceiveInvDate(todayLocal())
```

**Add date input to payment form** (after the Method `<label>`, before Pay button, ~line 359):
```tsx
<label className="block">
  <span className="block text-xs font-medium text-slate-600 mb-1">Date</span>
  <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)}
    className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
</label>
```

**Reset `payDate` after success** in `doPay` cleanup (~line 159):
```ts
setShowPay(null); setPayAmount(''); setPayDate(todayLocal())
```

---

### 2. `apps/frontend/src/pages/SalesPage.tsx`

**Import:** Add `import { todayLocal } from '../utils/dates'`

**State:** Add `const [payDate, setPayDate] = useState(todayLocal())`

**API call** in `doPay` (~line 101) — add `date: payDate`:
```ts
const res = await salesApi.recordPayment(selected.id, {
  amount: Number(payAmount),
  method: payMethod,
  date: payDate,          // <-- ADD THIS
  reference: payRef || undefined
})
```

**Add date input** to the sales payment form (after Amount, before Method):
```tsx
<label className="block">
  <span className="block text-xs font-medium text-slate-600 mb-1">Date</span>
  <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)}
    className="w-40 px-3 py-2 border border-slate-300 rounded-lg text-sm" />
</label>
```

**Reset `payDate`** after successful payment:
```ts
setPayAmount(''); setPayRef(''); setPayDate(todayLocal()); setShowPay(null)
```

---

### 3. `apps/frontend/src/pages/ProductionPage.tsx`

**Import:** Add `import { todayLocal } from '../utils/dates'`

**State:** Add `const [completeDate, setCompleteDate] = useState(todayLocal())`

**API call** in `doComplete` (~line 90) — add `date: completeDate`:
```ts
const res = await productionRunsApi.complete(selected.id, {
  actualPacks: Number(completePacks),
  date: completeDate        // <-- ADD THIS
})
```

**Add date input** next to "Actual packs" in the completion form (~lines 238-241):
```tsx
<label className="block">
  <span className="block text-xs font-medium text-slate-600 mb-1">Completion date</span>
  <input type="date" value={completeDate} onChange={e => setCompleteDate(e.target.value)}
    className="w-40 px-3 py-2 border border-slate-300 rounded-lg text-sm" />
</label>
```

**Reset `completeDate`** after successful completion:
```ts
setCompletePacks(''); setCompleteDate(todayLocal()); setSelected(null)
```

---

### 4. `apps/frontend/src/pages/InventoryPage.tsx`

**Import:** Add `import { todayLocal } from '../utils/dates'`

**State:** Add `const [adjustDate, setAdjustDate] = useState(todayLocal())`

**API call** in `doAdjust` (~line 82) — add `date: adjustDate`:
```ts
const res = await inventoryApi.adjustStock(adjustMaterial.id, Number(adjustValue), adjustReason, adjustDate)
```

**Add date input** in the adjustment modal (after Reason, before Save button, ~lines 198-209):
```tsx
<label className="block">
  <span className="block text-xs font-medium text-slate-600 mb-1">Date</span>
  <input type="date" value={adjustDate} onChange={e => setAdjustDate(e.target.value)}
    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
</label>
```

**Reset `adjustDate`** after success.

---

### 5. `apps/frontend/src/api/inventory.ts`

**Update `adjustStock`** to accept and pass `date`:
```ts
adjustStock: async (id: string, quantity: number, reason: string, date?: string) =>
  api.patch(`/inventory/materials/${id}/adjust-stock`, { newQuantity: quantity, reason, date }),
```

---

### 6. `apps/backend/src/modules/inventory/service.ts`

**Update `adjustStock` signature** to accept optional date:
```ts
async adjustStock(id: string, newQuantity: number, reason: string, date?: string): Promise<Material> {
```

**Update line 127** — use provided date instead of hardcoded UTC:
```ts
// BEFORE:
date: new Date().toISOString().split('T')[0],

// AFTER:
date: date || new Date().toISOString().split('T')[0],
```

---

### 7. `apps/backend/src/modules/inventory/controller.ts`

**Pass `date` from request body** to service:
```ts
const { newQuantity, reason, date } = req.body
const material = await inventoryService.adjustStock(req.params.id, newQuantity, reason, date)
```

---

## Verification

After all changes, run:
```bash
# From packages/types first
cd packages/types && npm run build

# Then typecheck both
cd apps/backend && npx tsc --noEmit
cd apps/frontend && npx tsc --noEmit
```

## What NOT to change

- `FinancePage.tsx` — already correct (uses `todayLocal()` everywhere)
- `ReportsPage.tsx` — already correct
- `GuideAngelPage.tsx` — already correct
- `DashboardPage.tsx` — read-only, no transactions
- `SettingsPage.tsx` — config only, no transactions
- `AdminPage.tsx` / `PlatformPage.tsx` — no transactions
