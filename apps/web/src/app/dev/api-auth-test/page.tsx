import { notFound } from "next/navigation";
import ApiAuthTest from "./test-client";

export default function ApiAuthTestPage() {
  if (process.env.NODE_ENV !== "development") {
    notFound();
  }

  return <ApiAuthTest />;
}
