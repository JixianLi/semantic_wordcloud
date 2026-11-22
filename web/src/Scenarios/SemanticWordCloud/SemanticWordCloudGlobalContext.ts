import { makeAutoObservable } from "mobx";
import type { GlobalContext } from "@core/Types/GlobalContext";

export class SemanticWordCloudGlobalContext implements GlobalContext {
  constructor() {
    makeAutoObservable(this);
  }

  initialize(_globalData: any): void {}

  async asyncInitialize(): Promise<void> {}

  toObject(): any {
    return {};
  }
}
