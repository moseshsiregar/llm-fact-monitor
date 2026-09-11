import { redirect } from "next/navigation";

export default function FactsPage() {
  redirect("/experiments/new");
}
