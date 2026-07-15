import type { Metadata } from "next";
import HusbandryApp from "./HusbandryApp";

export const metadata: Metadata = {
  title: "Shed",
  description: "Good care shows. Shared household husbandry, feeding, weights, and care history.",
};

export default function Home() {
  return <HusbandryApp />;
}
