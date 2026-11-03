import { LoaderCircle } from "lucide-react";

export function Spinner({ size = 18 }: { size?: number }) {
  return <LoaderCircle size={size} className="spin" />;
}
