import type { Metadata } from "next";
import { AdminApp } from "@/components/admin/AdminApp";

export const metadata: Metadata = { title: "Admin · Counter POS" };

export default function AdminPage() {
  return <AdminApp />;
}
