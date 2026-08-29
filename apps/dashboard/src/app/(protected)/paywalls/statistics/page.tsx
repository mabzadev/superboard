import { redirect } from "next/navigation";

export default function Page() {
  redirect("/flows/workflows?origin=paywalls&view=analytics");
}
