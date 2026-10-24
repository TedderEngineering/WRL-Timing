import { createContext, useContext } from "react";

/**
 * The phone race page's Race cards view, for share buttons elsewhere on the page (the lap
 * details' car and driver rows): open the view on a card. Null where there is no such view
 * (laptops, RaceTrace Live), and the buttons keep their own share instead.
 */
export const RaceCardsContext = createContext<((driver?: string) => void) | null>(null);

export const useOpenRaceCards = () => useContext(RaceCardsContext);
