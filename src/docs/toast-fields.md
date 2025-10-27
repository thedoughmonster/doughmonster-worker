# Toast API Field Reference Extract

The tables below capture the documented fields we surface in worker-facing docs. All text, types, and enum values come from the Toast Orders v2 and Menus v2 OpenAPI specifications that ship with this repository (`src/schemas/toast-orders-api.yaml`, `src/schemas/toast-menus-api.yaml`).

## Orders (`Order`)

| Field | Type | Required | Description / Enum |
| --- | --- | --- | --- |
| `guid` | `string` | ✅ | Toast reference GUID inherited from `ToastReference`. |
| `entityType` | `string` | ✅ (response) | Type discriminator returned by Toast for references. |
| `externalId` | `string` | ❌ | External identifier prefixed by naming authority. |
| `openedDate` | `string` (date-time) | ❌ | Business date of the order. Matches `createdDate` for ASAP orders and `promisedDate` for scheduled orders. |
| `modifiedDate` | `string` (date-time) | ❌ | Most recent modification timestamp for the order or any nested check/selection. |
| `promisedDate` | `string` (date-time) | ❌ | Scheduled fulfillment timestamp for future orders; `null` for dine-in/ASAP. |
| `channelGuid` | `string` (uuid) | ❌ | Reserved for future use. |
| `diningOption` | `ExternalReference` | ✅ | Restaurant-configured dining option applied to the order. |
| `checks` | `Check[]` | ✅ | One or more checks belonging to the order. |
| `table` | `ExternalReference` | ❌ | Table where the order was placed. |
| `serviceArea` | `ExternalReference` | ❌ (response) | Service area metadata. |
| `restaurantService` | `ExternalReference` | ❌ (response) | Meal service (lunch, dinner, etc.). |
| `revenueCenter` | `ExternalReference` | ❌ | Revenue center assigned to the order. |
| `source` | `string` | ❌ (response) | Ordering channel. Enum: In Store, Online, Order-and-Pay-at-Table, API, Kiosk, Caller Id, Google, Invoice, Toast Pickup App, Toast Local, Branded Online Ordering, Catering, Catering Online Ordering, Toast Tables, eCommerce Online ordering, Branded Mobile App, Grubhub (deprecated). |
| `duration` | `number` | ❌ (response) | Seconds between creation and payment. |
| `deliveryInfo` | `DeliveryInfo` | ❌ | Delivery metadata for `DELIVERY` orders. |
| `requiredPrepTime` | `string` (ISO-8601 duration) | ❌ | Overrides default prep window using five-minute increments. |
| `estimatedFulfillmentDate` | `string` (date-time) | ❌ (response) | Expected ready-for-pickup/delivery timestamp. |
| `numberOfGuests` | `number` | ❌ | Guest count associated with the order. |
| `voided` | `boolean` | ❌ (response) | `true` when the order is voided. |
| `voidDate` | `string` (date-time) | ❌ (response) | Timestamp for the void event. |
| `voidBusinessDate` | `number` | ❌ (response) | Business date (yyyyMMdd) tied to the void. |
| `paidDate` | `string` (date-time) | ❌ | Latest payment timestamp. Defaults to current time on `POST`. |
| `closedDate` | `string` (date-time) | ❌ | Timestamp when payment status moved to `CLOSED`. |
| `deletedDate` | `string` (date-time) | ❌ | Timestamp when the order was deleted (`1970-01-01T00:00:00.000+0000` when not deleted). |
| `deleted` | `boolean` | ❌ (response) | Indicates the order was deleted (for example when combined). |
| `businessDate` | `number` | ❌ (response) | Business date (yyyyMMdd) fulfilled. |
| `server` | `ExternalReference` | ❌ | Employee assigned to the order. |
| `pricingFeatures` | `string[]` | ❌ | Pricing features applied (enum includes `TAXESV2`, `TAXESV3`). |
| `approvalStatus` | `"NEEDS_APPROVAL" | "APPROVED" | "FUTURE" | "NOT_APPROVED"` | ❌ (response) | Workflow state of the order. |
| `createdDevice` | `Device` | ❌ | Toast POS device that created the order. |
| `createdDate` | `string` (date-time) | ❌ | Timestamp Toast received the order. |
| `lastModifiedDevice` | `Device` | ❌ | POS device responsible for most recent modification. |
| `curbsidePickupInfo` | `CurbsidePickupInfo` | ❌ | Guest pickup identification details. |
| `marketplaceFacilitatorTaxInfo` | `MarketplaceFacilitatorTaxInfo` | ❌ (`POST` only) | Marketplace facilitator tax remittance details. |
| `createdInTestMode` | `boolean` | ❌ | `true` if order was created while restaurant was in Toast test mode. |
| `appliedPackagingInfo` | `AppliedPackagingInfo` | ❌ | Guest packaging preferences. |
| `excessFood` | `boolean` | ❌ (response) | Marks orders created to track excess food. |
| `displayNumber` | `string` | ❌ (response) | Day-scoped display number printed on tickets. |

## Checks (`Check`)

| Field | Type | Required | Description / Enum |
| --- | --- | --- | --- |
| `guid` | `string` | ✅ | Toast reference GUID. |
| `selections` | `Selection[]` | ✅ | Menu item and modifier selections on the check. |
| `createdDate` | `string` (date-time) | ❌ | Timestamp Toast received the check. |
| `openedDate` | `string` (date-time) | ❌ | When the check opened (defaults to now). |
| `closedDate` | `string` (date-time) | ❌ | When payment status moved to `CLOSED`. |
| `modifiedDate` | `string` (date-time) | ❌ | Last modification timestamp. |
| `deletedDate` | `string` (date-time) | ❌ | Timestamp of deletion (`1970-01-01…` when active). |
| `deleted` | `boolean` | ❌ | `true` if the check was deleted. |
| `customer` | `Customer` | ❌ (`POST` delivery/takeout) | Guest info required for delivery/takeout orders. |
| `appliedLoyaltyInfo` | `AppliedLoyaltyInfo` | ❌ | Loyalty account accrual/redemption metadata. |
| `taxExempt` | `boolean` | ❌ (default `false`) | Whether the check is tax exempt. |
| `displayNumber` | `string` | ❌ | Ticket display number (not guaranteed unique). |
| `appliedServiceCharges` | `AppliedServiceCharge[]` | ❌ | Service charges applied to the check. |
| `amount` | `number` | ❌ (response) | Calculated check total excluding gratuity/tax. |
| `taxAmount` | `number` | ❌ (response) | Calculated tax total (including service-charge taxes). |
| `totalAmount` | `number` | ❌ | Total including discounts and taxes. |
| `payments` | `Payment[]` | ❌ | Payments applied to the check. |
| `tabName` | `string` | ❌ | Display name shown on the KDS. Up to 255 chars. |
| `paymentStatus` | `"OPEN" | "PAID" | "CLOSED"` | ❌ (response) | Payment workflow status. |
| `appliedDiscounts` | `AppliedDiscount[]` | ❌ | Discounts applied to the check. |
| `voided` | `boolean` | ❌ (response) | `true` if the check was voided. |
| `voidDate` | `string` (date-time) | ❌ (response) | Timestamp the check was voided. |
| `voidBusinessDate` | `number` | ❌ (response) | Business date (yyyyMMdd) of the void. |
| `paidDate` | `string` (date-time) | ❌ | Latest payment timestamp (defaults to now on `POST`). |
| `createdDevice` | `Device` | ❌ | POS device that created the check. |
| `lastModifiedDevice` | `Device` | ❌ | POS device that last modified the check. |
| `duration` | `number` | ❌ (response) | Seconds between creation and payment. |
| `openedBy` | `ExternalReference` | ❌ | Employee who opened the check. |

## Selections (`Selection`)

| Field | Type | Required | Description / Enum |
| --- | --- | --- | --- |
| `guid` | `string` | ✅ | Toast reference GUID. |
| `item` | `ConfigReference` | ✅ | Menu item reference selected. |
| `itemGroup` | `ConfigReference` | ✅ | Menu group reference used to pick the item. |
| `optionGroup` | `ConfigReference` | ❌ | Modifier group reference for modifier selections. |
| `preModifier` | `ConfigReference` | ❌ | Selected pre-modifier reference. |
| `quantity` | `number` | ✅ | Quantity ordered (supports decimals for weight). |
| `seatNumber` | `number` | ❌ (response) | Seat assignment (`-1` = unspecified, `0` = shared). |
| `unitOfMeasure` | `"NONE" | "LB" | "OZ" | "KG" | "G"` | ❌ | Unit of measure for weighed items. |
| `selectionType` | `"NONE" | "OPEN_ITEM" | "SPECIAL_REQUEST" | "PORTION" | "HOUSE_ACCOUNT_PAY_BALANCE" | "TOAST_CARD_SELL" | "TOAST_CARD_RELOAD"` | ❌ | Differentiates menu items, requests, fees, gift card actions, etc. |
| `salesCategory` | `ConfigReference` | ❌ (response) | Sales category reference. |
| `appliedDiscounts` | `AppliedDiscount[]` | ❌ (response) | Discounts applied to the selection. |
| `deferred` | `boolean` | ❌ | Marks deferred-revenue transactions (e.g., gift cards). |
| `preDiscountPrice` | `number` | ❌ (response) | Gross sale price before discounts (no tax). |
| `price` | `number` | ❌ (response) | Net price after discounts/modifiers. |
| `tax` | `number` | ❌ (response) | Total tax collected for the selection. |
| `voided` | `boolean` | ❌ (response) | `true` if the selection was voided. |
| `voidDate` | `string` (date-time) | ❌ (response) | Timestamp the selection was voided. |
| `voidBusinessDate` | `number` | ❌ (response) | Business date (yyyyMMdd) of the void. |
| `voidReason` | `ExternalReference` | ❌ (response) | Void reason reference. |
| `refundDetails` | `RefundDetails` | ❌ | Refunded amounts for the selection. |
| `displayName` | `string` | ❌ | Display name (also used for special requests). |
| `createdDate` | `string` (date-time) | ❌ | Creation timestamp (defaults to now). |
| `modifiedDate` | `string` (date-time) | ❌ | Last modification timestamp. |
| `modifiers` | `Selection[]` | ❌ | Nested modifier selections. |
| `fulfillmentStatus` | `"NEW" | "HOLD" | "SENT" | "READY"` | ❌ (response) | KDS workflow status for the selection. |
| `fulfillment` | `Fulfillment` | ❌ (response) | Additional fulfillment requirements. |
| `taxInclusion` | `"INCLUDED" | "NOT_INCLUDED" | "INHERITED"` | ❌ | Whether tax is included in price. |
| `appliedTaxes` | `AppliedTaxRate[]` | ❌ (response) | Itemized taxes applied. |
| `diningOption` | `ExternalReference` | ❌ (response) | Dining option reference applied to selection. |
| `openPriceAmount` | `number` | ❌ (`POST` only) | Open-price amount for configurable price items. |
| `receiptLinePrice` | `number` | ❌ | Base price before quantity/tax/discounts. |
| `optionGroupPricingMode` | `"INCLUDED" | "FIXED_PRICE" | "ADJUSTS_PRICE" | "REPLACES_PRICE" | "LOCATION_SPECIFIC_PRICE"` | ❌ | Pricing behavior of associated modifier group. |
| `externalPriceAmount` | `number` | ❌ (`POST` only) | Marketplace facilitator calculated price. |
| `splitOrigin` | `ToastReference` | ❌ | Reserved for future use. |

## Menus Document (`Restaurant`)

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `restaurantGuid` | `string` (uuid) | ❌ | Restaurant identifier for the published menu set. |
| `lastUpdated` | `string` | ❌ | Timestamp when menu data was last published. |
| `restaurantTimeZone` | `string` | ❌ | IANA time zone name for the restaurant. |
| `menus` | `Menu[]` | ❌ | Published menus, each containing groups/items. |
| `modifierGroupReferences` | `Record<string, ModifierGroup>` | ❌ | Map keyed by `referenceId` describing modifier groups. |
| `modifierOptionReferences` | `Record<string, ModifierOption>` | ❌ | Map keyed by `referenceId` describing modifier options. |
| `preModifierGroupReferences` | `Record<string, PreModifierGroup>` | ❌ | Map keyed by `referenceId` describing pre-modifier groups. |

### Menu (`Menu`)

Key fields used downstream:

* `name` (`string`) – Menu display name.
* `guid` (`string`) – Menu GUID.
* `description` (`string`) – Optional description.
* `menuGroups` (`MenuGroup[]`) – Hierarchy of menu groups inside the menu.

### Menu Group (`MenuGroup`)

Key fields used downstream:

* `name` (`string`) – Menu group name.
* `guid` (`string`) – Menu group GUID.
* `description` (`string`) – Optional description.
* `menuGroups` (`MenuGroup[]`) – Nested child groups.
* `menuItems` (`MenuItem[]`) – Items in the group.
* `itemTags` (`ItemTag[]`) – Tags assigned to the group.

### Menu Item (`MenuItem`)

Key fields used downstream:

* `name` (`string`) – Display name (`"Missing name"` substituted when blank).
* `kitchenName` (`string`) – Label used on kitchen tickets.
* `guid` (`string`) – Menu item GUID.
* `multiLocationId` (`string \| number`) – Shared identifier across locations.
* `description` (`string`) – Optional short description.
* `price` (`number`, double) – Resolved price for the menu item.
* `unitOfMeasure` (`"NONE" | "LB" | "OZ" | "KG" | "G"`) – Unit for weight-based pricing.
* `modifierGroupReferences` (`number[]`) – Reference IDs for linked modifier groups.
* `itemTags` (`ItemTag[]`) – Tags applied to the item.
* `portions` (`Portion[]`) – Available portion definitions.

### Modifier Group (`ModifierGroup`)

* `name` (`string`) – Display name.
* `guid` (`string`) – Modifier group GUID.
* `referenceId` (`number`) – Numeric identifier used by items/portions.
* `pricingStrategy` (`string`) – Pricing model (`NONE`, `SIZE_PRICE`, `SEQUENCE_PRICE`, `SIZE_SEQUENCE_PRICE`).
* `pricingRules` (`PricingRules | null`) – Strategy-specific pricing info.
* `defaultOptionsChargePrice` (`"YES" | "NO"`) – Whether default modifiers add price.
* `defaultOptionsSubstitutionPricing` (`"YES" | "NO"`) – Enables substitution pricing.
* `minSelections` / `maxSelections` (`number`) – Selection bounds (null = unlimited max).
* `requiredMode` (`"REQUIRED" | "OPTIONAL_FORCE_SHOW" | "OPTIONAL"`) – POS behavior.
* `isMultiSelect` (`boolean`) – Allows multiple selections.
* `preModifierGroupReference` (`number`) – Linked pre-modifier group referenceId.
* `modifierOptionReferences` (`number[]`) – Reference IDs for contained options.

### Modifier Option (`ModifierOption`)

* `referenceId` (`number`) – Numeric identifier used by modifier groups.
* `name` (`string`) – Display name (Toast substitutes `"Missing name"` when blank).
* `guid` (`string`) – Modifier option GUID (item reference).
* `description` (`string`) – Optional description.
* `price` (`number | null`) – Resolved price based on pricing strategy.
* `pricingStrategy` (`string`) – Pricing approach (`GROUP_PRICE`, `BASE_PRICE`, `MENU_SPECIFIC_PRICE`, `TIME_SPECIFIC_PRICE`, etc.).
* `pricingRules` (`PricingRules | null`) – Additional data when price needs calculation.
* `salesCategory` (`SalesCategory`) – Sales category reference.
* `itemTags` (`ItemTag[]`) – Tags applied to the modifier option.
* `isDefault` (`boolean`) – Included by default with parent item.
* `allowsDuplicates` (`boolean`) – Whether option can be selected multiple times.
* `portions` (`Portion[]`) – Portions the modifier can cover.

These field lists feed the generated TypeScript definitions and schema metadata so that downstream OpenAPI tooling can surface Toast-specific semantics without scraping inline comments.
