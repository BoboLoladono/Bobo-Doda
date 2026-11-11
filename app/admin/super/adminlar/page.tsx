"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AdminPageHeader } from "@/components/admin/AdminUI";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/ErrorState";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Table, type TableColumn } from "@/components/ui/Table";
import { addAdmin, getAdminAccounts, setAdminActive, updateAdminAccount } from "@/lib/api/admin";
import { adminErrorText } from "@/lib/admin-error-text";
import type { AdminAccount, AdminPermission, AdminRole } from "@/lib/admin-types";

const operationalPermissions: { value: AdminPermission; label: string }[] = [
  { value: "users", label: "Foydalanuvchilar" },
  { value: "kyc", label: "KYC" },
  { value: "disputes", label: "Nizolar" },
  { value: "payments", label: "To‘lovlar" },
  { value: "support", label: "Yordam" },
];

export default function AdminsPage() {
  const [admins, setAdmins] = useState<AdminAccount[]>([]);
  const [open, setOpen] = useState(false);
  const [editingAdmin, setEditingAdmin] = useState<AdminAccount | null>(null);
  const [editForm, setEditForm] = useState<{
    fullName: string;
    title: string;
    role: AdminRole;
    permissions: AdminPermission[];
  }>({
    fullName: "",
    title: "",
    role: "admin",
    permissions: [],
  });
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    fullName: "", email: "", title: "", password: "",
    permissions: operationalPermissions.map((item) => item.value),
  });
  const [loadError, setLoadError] = useState<unknown>(null);

  const load = useCallback(() => {
    setLoadError(null);
    getAdminAccounts().then(setAdmins).catch(setLoadError);
  }, []);

  useEffect(load, [load]);

  async function create(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await addAdmin(form);
      setAdmins(await getAdminAccounts());
      setOpen(false);
      setForm({
        fullName: "", email: "", title: "", password: "",
        permissions: operationalPermissions.map((item) => item.value),
      });
    } catch (err) {
      setError(adminErrorText(err));
    }
  }

  async function toggle(item: AdminAccount) {
    setError("");
    try {
      await setAdminActive(item.id, !item.active);
      setAdmins(await getAdminAccounts());
    } catch (err) {
      setError(adminErrorText(err));
    }
  }

  function openEdit(item: AdminAccount) {
    setEditingAdmin(item);
    setEditForm({
      fullName: item.fullName,
      title: item.title,
      role: item.role,
      permissions: [...item.permissions],
    });
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editingAdmin) return;
    setError("");
    try {
      await updateAdminAccount(editingAdmin.id, editForm);
      setAdmins(await getAdminAccounts());
      setEditingAdmin(null);
    } catch (err) {
      setError(adminErrorText(err));
    }
  }

  const columns: TableColumn<AdminAccount>[] = [
    { key: "name", header: "Administrator", render: (row) => <div><p className="font-medium">{row.fullName}</p><p className="text-2xs text-faint">{row.email}</p></div> },
    { key: "role", header: "Rol", render: (row) => <Badge tone={row.role === "super_admin" ? "danger" : "primary"}>{row.role === "super_admin" ? "Super Admin" : "Admin"}</Badge> },
    { key: "status", header: "Holat", render: (row) => <Badge tone={row.active ? "success" : "danger"}>{row.active ? "Faol" : "Bloklangan"}</Badge> },
    { key: "created", header: "Ruxsatlar", render: (row) => <span className="text-xs text-muted">{row.role === "super_admin" ? "Barchasi" : `${row.permissions.length} modul`}</span> },
    {
      key: "action",
      header: "Amallar",
      render: (row) => (
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => openEdit(row)}>
            Tahrirlash
          </Button>
          <Button variant={row.active ? "danger" : "secondary"} size="sm" onClick={() => toggle(row)}>
            {row.active ? "Bloklash" : "Faollashtirish"}
          </Button>
        </div>
      ),
    },
  ];

  if (loadError) {
    return (
      <>
        <AdminPageHeader title="Adminlar boshqaruvi" description="CEO yangi operatsion admin yaratadi yoki uning kirishini to‘xtatadi." />
        <ErrorState error={loadError} onRetry={load} />
      </>
    );
  }

  return (
    <>
      <AdminPageHeader
        title="Adminlar boshqaruvi"
        description="CEO yangi operatsion admin yaratadi yoki uning kirishini to‘xtatadi. Super Admin vakolati delegatsiya qilinmaydi."
        action={<Button onClick={() => setOpen(true)}>Admin qo‘shish</Button>}
        backHref="/admin"
      />
      {error && <p role="alert" className="mb-4 rounded-input bg-danger/10 p-3 text-xs text-danger-deep">{error}</p>}
      <Table columns={columns} rows={admins} rowKey={(row) => row.id} renderMobileCard={(row) => (
        <Card padding="none" className="border-0">
          <div className="flex justify-between gap-3">
            <div>
              <p className="font-medium">{row.fullName}</p>
              <p className="text-xs text-muted">{row.email}</p>
            </div>
            <Badge tone={row.role === "super_admin" ? "danger" : "primary"}>
              {row.role === "super_admin" ? "Super Admin" : "Admin"}
            </Badge>
          </div>
          <div className="mt-4 flex gap-2">
            <Button className="flex-1" variant="secondary" size="sm" onClick={() => openEdit(row)}>
              Tahrirlash
            </Button>
            <Button className="flex-1" variant={row.active ? "danger" : "secondary"} size="sm" onClick={() => toggle(row)}>
              {row.active ? "Bloklash" : "Faollashtirish"}
            </Button>
          </div>
        </Card>
      )} />
      <Modal open={open} onClose={() => setOpen(false)} title="Yangi operatsion admin">
        <form onSubmit={create} className="flex flex-col gap-4">
          <Input label="To‘liq ism" value={form.fullName} onChange={(e) => { setForm({ ...form, fullName: e.target.value }); if (error) setError(""); }} required maxLength={100} />
          <Input label="Korporativ email" type="email" value={form.email} onChange={(e) => { setForm({ ...form, email: e.target.value }); if (error) setError(""); }} required />
          <Input label="Lavozim" value={form.title} onChange={(e) => { setForm({ ...form, title: e.target.value }); if (error) setError(""); }} required maxLength={100} />
          <Input label="Vaqtinchalik parol" type="password" autoComplete="new-password" value={form.password} onChange={(e) => { setForm({ ...form, password: e.target.value }); if (error) setError(""); }} required minLength={10} hint="Kamida 10 belgi, katta-kichik harf va raqam" />
          <fieldset>
            <legend className="mb-2 text-xs font-medium text-muted">Modul ruxsatlari</legend>
            <div className="grid grid-cols-2 gap-2">
              {operationalPermissions.map((permission) => (
                <label key={permission.value} className="flex items-center gap-2 text-xs text-ink">
                  <input
                    type="checkbox"
                    checked={form.permissions.includes(permission.value)}
                    onChange={(e) => setForm({
                      ...form,
                      permissions: e.target.checked
                        ? [...form.permissions, permission.value]
                        : form.permissions.filter((item) => item !== permission.value),
                    })}
                  />
                  {permission.label}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Bekor qilish</Button><Button type="submit">Yaratish</Button></div>
        </form>
      </Modal>

      <Modal
        open={Boolean(editingAdmin)}
        onClose={() => setEditingAdmin(null)}
        title={`Adminni tahrirlash — ${editingAdmin?.email || ""}`}
      >
        <form onSubmit={saveEdit} className="flex flex-col gap-4">
          <Input
            label="To‘liq ism"
            value={editForm.fullName}
            onChange={(e) => setEditForm({ ...editForm, fullName: e.target.value })}
            required
            maxLength={100}
          />
          <Input
            label="Lavozim"
            value={editForm.title}
            onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
            required
            maxLength={100}
          />
          {editingAdmin?.role !== "super_admin" && (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Admin roli</label>
              <select
                value={editForm.role}
                onChange={(e) => setEditForm({ ...editForm, role: e.target.value as AdminRole })}
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand"
              >
                <option value="admin">Operatsion Admin</option>
                <option value="finance">Moliya Admin (Finance)</option>
                <option value="support">Qo'llab-quvvatlash (Support)</option>
                <option value="kyc_reviewer">KYC Tekshiruvchi</option>
                <option value="trust_safety">Xavfsizlik (Trust & Safety)</option>
              </select>
            </div>
          )}
          <fieldset>
            <legend className="mb-2 text-xs font-medium text-muted">Modul ruxsatlari</legend>
            <div className="grid grid-cols-2 gap-2">
              {operationalPermissions.map((permission) => (
                <label key={permission.value} className="flex items-center gap-2 text-xs text-ink">
                  <input
                    type="checkbox"
                    checked={editForm.permissions.includes(permission.value)}
                    disabled={editingAdmin?.role === "super_admin"}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        permissions: e.target.checked
                          ? [...editForm.permissions, permission.value]
                          : editForm.permissions.filter((item) => item !== permission.value),
                      })
                    }
                  />
                  {permission.label}
                </label>
              ))}
            </div>
            {editingAdmin?.role === "super_admin" && (
              <p className="mt-2 text-2xs text-muted">Super Admin barcha modullarga avtomatik to'liq huquqqa ega.</p>
            )}
          </fieldset>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setEditingAdmin(null)}>
              Bekor qilish
            </Button>
            <Button type="submit">
              Saqlash
            </Button>
          </div>
        </form>
      </Modal>

    </>
  );
}
