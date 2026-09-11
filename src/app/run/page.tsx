import { redirect } from "next/navigation";

export default function RunExperimentPage() {
  redirect("/experiments/new");
}
