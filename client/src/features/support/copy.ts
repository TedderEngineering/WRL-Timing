/**
 * Wording for the support sheet and asks, per site. RaceTrace and Finding Grip
 * share the same sheet, timing rules and Stripe account; only the names, the
 * "what it pays for" line and where the supporter returns to differ.
 */
export type SupportSite = "racetrace" | "grip";

export interface SupportCopy {
  site: SupportSite;
  /** Shown on the thank-you page button: "Back to …". */
  name: string;
  sheetTitle: string;
  /** One line on what coffees pay for, specific to the site. */
  sheetBody: string;
  /** The contextual ask, shown once after the visitor got something useful. */
  askLead: string;
  askBody: string;
  cardTitle: string;
  cardBody: string;
  thanksBody: string;
  thanksCardBody: string;
}

export const RACETRACE_COPY: SupportCopy = {
  site: "racetrace",
  name: "RaceTrace",
  sheetTitle: "Keep RaceTrace free",
  sheetBody:
    "RaceTrace has no paywall and no ads. Coffees pay for the hosting, the timing data and the analysis Claude writes for every race.",
  askLead: "Enjoyed this recap?",
  askBody:
    "I'm Brent, and I build RaceTrace. It's free, with no ads. One coffee covers the analysis of about one race.",
  cardTitle: "RaceTrace is free",
  cardBody: "No paywall, no ads. If it helps your team, a coffee keeps the data flowing.",
  thanksBody:
    "That's another race analysed. RaceTrace stays free for everyone, and I won't ask you again this season.",
  thanksCardBody: "That's another race analysed. I won't ask you again this season.",
};

export const GRIP_COPY: SupportCopy = {
  site: "grip",
  name: "Finding Grip",
  sheetTitle: "Keep Finding Grip free",
  sheetBody:
    "Finding Grip has no paywall and no ads. Coffees pay for the hosting and the time I spend improving the calculator and the damper guide.",
  // Shown once, right after a run is recorded as on target (GripOutcomePage),
  // under the verdict "Came in within 0.3 PSI on all four corners".
  askLead: "On target.",
  askBody:
    "I'm Brent, and I build Finding Grip. It's free, with no ads. If it helped you get there, a coffee keeps it running.",
  cardTitle: "Finding Grip is free",
  cardBody:
    "No paywall, no ads. If it helps you come in on target, a coffee keeps it running.",
  thanksBody:
    "Thank you for backing Finding Grip. It stays free for every driver, and I won't ask you again this season.",
  thanksCardBody: "Thanks for backing Finding Grip. I won't ask you again this season.",
};

export const SUPPORT_COPY: Record<SupportSite, SupportCopy> = {
  racetrace: RACETRACE_COPY,
  grip: GRIP_COPY,
};
