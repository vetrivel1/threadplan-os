"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { format, addDays } from "date-fns";
import { X, Plus } from "lucide-react";
import type { Order, PackingType } from "@/lib/types";
import type { SimulatedOrderInput } from "@/lib/store/schedule-store";
import { useScheduleStore } from "@/lib/store/schedule-store";

function daysFromNow(n: number): string {
  return format(addDays(new Date(), n), "yyyy-MM-dd");
}

function orderToForm(order: Order): SimulatedOrderInput {
  return {
    orderNumber: `PO-2026-${Math.floor(1000 + Math.random() * 9000)}`,
    styleId: order.styleId,
    quantity: order.quantity,
    packingType: order.packingType,
    rmInHouseDate: order.rmInHouseDate,
    deliveryDeadline: order.deliveryDeadline,
    priority: order.priority + 10,
  };
}

const EMPTY_FORM: SimulatedOrderInput = {
  orderNumber: `PO-2026-${Math.floor(1000 + Math.random() * 9000)}`,
  styleId: "",
  quantity: 3000,
  packingType: "solid",
  rmInHouseDate: daysFromNow(2),
  deliveryDeadline: daysFromNow(16),
  priority: 50,
};

interface Props {
  open: boolean;
  onClose: () => void;
}

export function SimulateOrderModal({ open, onClose }: Props) {
  const router = useRouter();
  const { orders, styles, simulateErpOrder } = useScheduleStore();
  const [form, setForm] = useState<SimulatedOrderInput>(EMPTY_FORM);

  if (!open) return null;

  const loadTemplate = (orderId: string) => {
    const order = orders.find((o) => o.id === orderId);
    if (order) setForm(orderToForm(order));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.styleId) return;
    simulateErpOrder(form);
    onClose();
    router.push("/auto-sequence");
    setForm({
      ...EMPTY_FORM,
      orderNumber: `PO-2026-${Math.floor(1000 + Math.random() * 9000)}`,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-xl border border-border bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h2 className="font-semibold">Simulate ERP Order</h2>
            <p className="text-xs text-muted">
              Prefill from an existing order, modify, and trigger auto-sequence
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-muted hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          <div>
            <label className="text-xs text-muted">Prefill from template</label>
            <select
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              defaultValue=""
              onChange={(e) => e.target.value && loadTemplate(e.target.value)}
            >
              <option value="" disabled>
                Select an existing ERP order…
              </option>
              {orders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.orderNumber}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="text-xs text-muted">ERP Order Number</label>
              <input
                required
                value={form.orderNumber}
                onChange={(e) => setForm({ ...form, orderNumber: e.target.value })}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-muted">Style</label>
              <select
                required
                value={form.styleId}
                onChange={(e) => setForm({ ...form, styleId: e.target.value })}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="" disabled>
                  Select style…
                </option>
                {styles.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} — {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted">Quantity</label>
              <input
                type="number"
                required
                min={1}
                value={form.quantity}
                onChange={(e) =>
                  setForm({ ...form, quantity: parseInt(e.target.value, 10) })
                }
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-muted">Packing</label>
              <select
                value={form.packingType}
                onChange={(e) =>
                  setForm({ ...form, packingType: e.target.value as PackingType })
                }
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="solid">Solid</option>
                <option value="assorted">Assorted</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted">RM In-House Date</label>
              <input
                type="date"
                required
                value={form.rmInHouseDate}
                onChange={(e) =>
                  setForm({ ...form, rmInHouseDate: e.target.value })
                }
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-muted">Delivery Deadline</label>
              <input
                type="date"
                required
                value={form.deliveryDeadline}
                onChange={(e) =>
                  setForm({ ...form, deliveryDeadline: e.target.value })
                }
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-muted">ERP Priority</label>
              <input
                type="number"
                required
                value={form.priority}
                onChange={(e) =>
                  setForm({ ...form, priority: parseInt(e.target.value, 10) })
                }
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-border py-2.5 text-sm hover:bg-surface-elevated"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-accent py-2.5 text-sm font-medium text-white hover:bg-accent-hover"
            >
              <Plus className="h-4 w-4" />
              Send to ERP &amp; Auto-Sequence
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
