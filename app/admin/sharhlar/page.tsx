"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminPageHeader, MetricCard, Pagination } from "@/components/admin/AdminUI";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Table, type TableColumn } from "@/components/ui/Table";
import {
  deleteReview,
  listReviewsQueue,
  type AdminPage,
} from "@/lib/api/admin";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";
import { useToast } from "@/components/ui/Toast";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { adminErrorText } from "@/lib/admin-error-text";
import { formatDate } from "@/lib/format";
import type { Review } from "@/lib/types";

export default function ReviewsModerationPage() {
  const { toast } = useToast();
  const [page, setPage] = useState<AdminPage<Review> | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [deleteTarget, setDeleteTarget] = useState<Review | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [search, setSearch] = useState("");
  const [ratingFilter, setRatingFilter] = useState<string>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  const [selectedReview, setSelectedReview] = useState<Review | null>(null);

  /* Qidiruv debounce bilan — aks holda backend'da har harfda so'rov ketardi */
  const debouncedSearch = useDebouncedValue(search, 300);

  /* SERVER tomonida filtrlanadi va sahifalanadi. */
  const load = useCallback(() => {
    setLoadError(null);
    listReviewsQueue({
      page: currentPage,
      perPage: rowsPerPage,
      search: debouncedSearch,
      status: ratingFilter,
    })
      .then(setPage)
      .catch(setLoadError);
  }, [currentPage, rowsPerPage, debouncedSearch, ratingFilter]);

  useEffect(load, [load]);

  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch, ratingFilter, rowsPerPage]);

  /* KPI — faset sanoqlaridan. O'rtacha reyting yig'indi/soni bo'yicha
     hisoblanadi (backend `AVG(rating)` qaytaradi). */
  const facets = page?.facets ?? {};
  const reviewTotal = facets._all ?? 0;
  const stats = {
    total: reviewTotal,
    avg: reviewTotal ? ((facets.ratingSum ?? 0) / reviewTotal).toFixed(1) : null,
    lowRating: (facets["1"] ?? 0) + (facets["2"] ?? 0),
    highRating: facets["5"] ?? 0,
  };


  /* O'chirish API qatlamidan o'tadi: ruxsat tekshiriladi, audit izi qoladi.
     Ilgari sahifa localStorage ga o'zi yozardi va native `confirm()` so'rardi. */
  async function handleDeleteReview() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteReview(deleteTarget.id);
      load();
      setDeleteTarget(null);
      setSelectedReview(null);
      toast("Sharh o'chirildi");
    } catch (err) {
      toast(adminErrorText(err), "error");
    } finally {
      setDeleting(false);
    }
  }

  const columns: TableColumn<Review>[] = [
    {
      key: "buyerName",
      header: "Muallif & Mutaxassis",
      render: (r) => (
        <div className="min-w-0">
          <p className="font-bold text-ink truncate">{r.buyerName || "Mijoz"}</p>
          <p className="text-2xs text-muted">
            Mutaxassis ID: <span className="font-mono text-ink">{r.sellerId}</span>
          </p>
          <p className="text-3xs text-muted font-mono">Shartnoma: #{r.contractId}</p>
        </div>
      ),
    },
    {
      key: "rating",
      header: "Baho",
      render: (r) => (
        <div className="flex items-center gap-1">
          <span className="font-bold text-warning-deep text-xs">⭐ {r.rating}.0</span>
        </div>
      ),
    },
    {
      key: "comment",
      header: "Sharh Matni",
      render: (r) => (
        <p className="text-xs text-ink truncate max-w-sm">{r.comment}</p>
      ),
    },
    {
      key: "createdAt",
      header: "Qoldirilgan",
      render: (r) => <span className="text-xs text-muted">{formatDate(r.createdAt)}</span>,
    },
    {
      key: "action",
      header: "Amal",
      render: (r) => (
        <Button size="sm" variant="outline" onClick={() => setSelectedReview(r)} className="text-xs">
          Ko‘rish →
        </Button>
      ),
    },
  ];

  /* XATO HOLATI YUKLANISH HOLATIDAN OLDIN tekshiriladi. Ilgari tartib
     teskari edi va bu butun admin panelida bir xil xatoga olib kelardi:
     yuklash yiqilsa holat `null` bo'lib qolar, birinchi shart
     ishlab "Yuklanmoqda..." qaytarardi va pastdagi `<ErrorState>` bloki
     HECH QACHON chizilmasdi — operator abadiy "yuklanmoqda" ekranini
     ko'rar, qayta urinish tugmasi esa o'lik kod edi. */
  if (loadError) {
    return (
      <div className="space-y-6">
        <AdminPageHeader
          title="Sharhlar & Baholashlar Moderatsiyasi"
          description="Buyurtmachilar tomonidan qoldirilgan reytinglar va izohlarning shaffofligi."
        />
        <ErrorState error={loadError} onRetry={load} />
      </div>
    );
  }

  if (!page) {
    return (
      <div className="space-y-6">
        <AdminPageHeader
          title="Sharhlar moderatsiyasi"
          description="Foydalanuvchilar qoldirgan sharhlarni nazorat qilish va noo‘rin sharhlarni o‘chirish."
        />
        <LoadingState message="Sharhlar ro'yxati yuklanmoqda..." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Sharhlar & Baholashlar Moderatsiyasi"
        description="Buyurtmachilar tomonidan qoldirilgan reytinglar va izohlarning shaffofligi, haqoratli mazmunni olib tashlash."
      />

      {/* KPI Cards */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Jami Sharhlar" value={stats.total} detail="Barcha loyihalar bo'yicha" />
        <MetricCard label="O‘rtacha Reyting" value={stats.avg ? `⭐ ${stats.avg}` : "—"} detail="Platforma bo'yicha o'rtacha" tone="success" />
        <MetricCard label="A'lo Baholar (5★)" value={stats.highRating} detail="Maksimal qoniqish" tone="primary" />
        <MetricCard label="Salbiy Baholar (≤2★)" value={stats.lowRating} detail="Norozi mijozlar izohlari" tone="warning" />
      </section>

      {/* Filter and Search */}
      <Card padding="md" className="space-y-3">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <select
              aria-label="Baho bo'yicha filtr"
              value={ratingFilter}
              onChange={(e) => setRatingFilter(e.target.value)}
              className="rounded-lg border border-line bg-card px-3 py-1.5 text-xs text-ink outline-none focus:border-primary"
            >
              <option value="all">Barcha baholar</option>
              <option value="5">5 yulduz ⭐⭐⭐⭐⭐</option>
              <option value="4">4 yulduz ⭐⭐⭐⭐</option>
              <option value="3">3 yulduz ⭐⭐⭐</option>
              <option value="2">2 yulduz ⭐⭐</option>
              <option value="1">1 yulduz ⭐</option>
            </select>
          </div>

          <div className="w-full sm:w-72">
            <Input
              aria-label="Qidirish"
              placeholder="Sharh matni, muallif yoki mutaxassis ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </Card>

      {/* Table */}
      <div className="mt-4">
        {page.items.length ? (
          <>
            <Table
              columns={columns}
              rows={page.items}
              rowKey={(r) => r.id}
              renderMobileCard={(r) => (
                <div className="flex items-start justify-between gap-3 p-3 border border-line rounded-xl bg-card">
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-ink truncate">{r.buyerName || "Mijoz"}</p>
                    <p className="text-xs text-warning-deep font-bold">⭐ {r.rating}.0</p>
                    <p className="text-xs text-ink mt-1 truncate">{r.comment}</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setSelectedReview(r)} className="shrink-0 text-xs">
                    Ko‘rish
                  </Button>
                </div>
              )}
            />
            <Pagination
              currentPage={page.page}
              totalPages={page.totalPages}
              onPageChange={setCurrentPage}
              totalRows={page.total}
              rowsPerPage={page.perPage}
              onRowsPerPageChange={setRowsPerPage}
            />
          </>
        ) : (
          <Card className="py-12 text-center text-xs text-muted">
            Sharhlar topilmadi.
          </Card>
        )}
      </div>

      {/* Modal Detail */}
      {selectedReview && (
        <Modal
          open={Boolean(selectedReview)}
          onClose={() => setSelectedReview(null)}
          title={`Sharh ma'lumotlari #${selectedReview.id}`}
          size="md"
          footer={
            <div className="flex items-center justify-between w-full">
              <Button
                type="button"
                size="sm"
                variant="outline"
                tone="danger"
                onClick={() => setDeleteTarget(selectedReview)}
              >
                Noo‘rin sharhni o‘chirish
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setSelectedReview(null)}>
                Yopish
              </Button>
            </div>
          }
        >
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-3 rounded-xl border border-line bg-surface/60 p-3">
              <div>
                <span className="text-3xs uppercase font-bold text-muted">Muallif:</span>
                <p className="font-bold text-ink mt-0.5">{selectedReview.buyerName || "Mijoz"}</p>
              </div>
              <div>
                <span className="text-3xs uppercase font-bold text-muted">Baho:</span>
                <p className="font-bold text-warning-deep mt-0.5">⭐ {selectedReview.rating} / 5.0</p>
              </div>
            </div>

            <div>
              <span className="text-3xs uppercase font-bold text-muted block mb-1">To‘liq izoh matni:</span>
              <div className="rounded-xl border border-line bg-card p-3.5 text-xs text-ink leading-relaxed whitespace-pre-wrap">
                {selectedReview.comment}
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* O'chirishni tasdiqlash — native confirm() o'rniga (dizayn tizimida,
          o'chiriladigan sharh matni ko'rinadi) */}
      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Sharhni o'chirish"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Bekor qilish
            </Button>
            <Button variant="danger" onClick={handleDeleteReview} loading={deleting}>
              {"O'chirish"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            {"Sharh butunlay o'chiriladi va mutaxassis reytingi qayta hisoblanadi. "}
            {"Bu amalni qaytarib bo'lmaydi."}
          </p>
          {deleteTarget && (
            <div className="rounded-input border border-line bg-surface p-3">
              <p className="text-2xs font-bold uppercase tracking-wide text-faint">
                {deleteTarget.buyerName || "Mijoz"} · {deleteTarget.rating}/5
              </p>
              <p className="mt-1 line-clamp-4 text-xs text-ink">{deleteTarget.comment}</p>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
