export class Address {}
export class Customer {
  readonly address?: Address;
  save(input: Address): Address { return input; }
}
