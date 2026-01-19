// Copyright (c) 2025 Anton A Nesterov <an+vski@vski.sh>, VSKI License
//

export class StopRollback extends Error {
  constructor(message: string = "Rollback stopped") {
    super(message);
    this.name = "StopRollback";
  }
}
