import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CarTabs, carTabLabel } from "../CarTabs";

const cars = [
  { id: "c1", number: "6", label: "Z's Car", series: "imsa", teamName: null },
  { id: "c2", number: "67", label: null, series: "wrl", teamName: "Blackdog Racing" },
];

describe("car tabs", () => {
  it("label each car by number, name and series", () => {
    expect(cars.map(carTabLabel)).toEqual(["#6 · Z's Car · IMSA", "#67 Blackdog Racing · WRL"]);
  });
  it("show only when there is more than one car, with the shown car selected", () => {
    expect(renderToStaticMarkup(<CarTabs cars={[cars[0]]} active="c1" onChoose={() => {}} />)).toBe("");
    const html = renderToStaticMarkup(<CarTabs cars={cars} active="c2" onChoose={() => {}} />);
    expect(html).toMatch(/aria-selected="true"[^>]*>#67 Blackdog Racing · WRL</);
  });
});
