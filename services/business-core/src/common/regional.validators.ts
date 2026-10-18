import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from "class-validator";

const supportedCurrencies = new Set(Intl.supportedValuesOf("currency"));

/** A three-letter ISO 4217 code the runtime knows (upper case), for services outside DTO validation. */
export function isCurrencyCode(value: string) {
  return supportedCurrencies.has(value);
}

function decorator(
  name: string,
  predicate: (value: string) => boolean,
  defaultMessage: (args: ValidationArguments) => string,
) {
  return (validationOptions?: ValidationOptions) =>
    (object: object, propertyName: string) => {
      registerDecorator({
        name,
        target: object.constructor,
        propertyName,
        options: validationOptions,
        validator: {
          validate(value: unknown) {
            return typeof value === "string" && predicate(value);
          },
          defaultMessage,
        },
      });
    };
}

export const IsCurrencyCode = decorator(
  "isCurrencyCode",
  (value) => isCurrencyCode(value),
  (args) => `${args.property} must be a three-letter ISO 4217 currency code`,
);

export const IsCountryCode = decorator(
  "isCountryCode",
  (value) => /^[A-Z]{2}$/.test(value),
  (args) => `${args.property} must be a two-letter ISO 3166 country code`,
);

export const IsLocale = decorator(
  "isLocale",
  (value) => {
    try {
      return Intl.getCanonicalLocales(value).length === 1;
    } catch {
      return false;
    }
  },
  (args) => `${args.property} must be a valid BCP 47 locale`,
);

export const IsTimeZone = decorator(
  "isTimeZone",
  (value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  },
  (args) => `${args.property} must be a valid IANA timezone`,
);
