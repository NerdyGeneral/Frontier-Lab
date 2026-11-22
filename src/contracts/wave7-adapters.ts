/** Captured by an explicitly selected, paid frozen-base adaptation run. */
export interface AdapterTrainingReceipt {
  baseModelId: string;
  rolloutId: string;
  baseResidentMU: number;
  adapterMemoryMU: number;
}

/** A public serving request may reuse these exact weights within one pool. */
export interface SharedAdapterMemory {
  baseModelId: string;
  modelId: string;
  baseMemoryMU: number;
  adapterMemoryMU: number;
}

export interface AdapterBankModelView {
  id: string;
  name: string;
  evaluated: boolean;
  hosted: boolean;
  weights: boolean;
  activeProducts: string[];
}

export interface AdapterBankGroupView {
  baseModelId: string;
  baseName: string;
  baseMemoryMU: number;
  adapters: AdapterBankModelView[];
  activeModels: number;
  activeProducts: number;
  independentMemoryMU: number;
  sharedMemoryMU: number;
}
