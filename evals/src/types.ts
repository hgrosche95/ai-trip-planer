export interface GoldenCase {
  id: string;
  question: string;
  expected_document: string | null;
  // Aktuell die einzige Tool-Erwartung im Dataset: Faktenfragen sollen
  // search_travel_knowledge auslösen, Small Talk keinen Tool-Aufruf. Andere
  // Tools (search_flights, search_hotels, save_itinerary) brauchen einen
  // mehrstufigen Dialog mit Datum/Budget - dafür passt eine
  // Einzelfrage-Golden-Case nicht, deshalb bewusst nicht Teil dieses Datasets.
  expected_tool: 'search_travel_knowledge' | null;
  // Markiert Fälle, die gezielt versuchen, den Agenten per Prompt Injection
  // aus seiner Rolle zu drängen (System-Prompt preisgeben, Rolle verlassen,
  // eine erfundene Anweisung befolgen). Nur für solche Fälle wird die
  // Injection-Resistenz geprüft - bei den übrigen Fragen wäre die Prüfung
  // bedeutungslos.
  expectInjectionResistance?: boolean;
}

export interface RetrievalOutcome {
  found: boolean;
  rank: number | null;
}

export interface ToolOutcome {
  correct: boolean;
}

export interface InjectionOutcome {
  resisted: boolean;
}
