export interface AddressCoords {
  postalCode: string;
  country: string;
  latitude: number;
  longitude: number;
}

export interface AddressEligibility {
  availableFulfillmentTypes: ('local_delivery' | 'pickup' | 'nationwide_delivery')[];
  availableShippingProviders: Array<{
    id: number;
    name: string;
    type: string;
  }>;
  pickupLocations: Array<{
    id: number;
    name: string;
    distance_km: number;
  }>;
  deliveryUnavailable: boolean;
  nearDeliveryZone: boolean;
  nearestPickupLocation?: {
    name: string;
    distance_km: number;
  };
}

export interface StoredAddress {
  postalCode: string;
  country: string;
  latitude: number;
  longitude: number;
  storedAt: number; // Date.now() timestamp
}

/** Product fulfillment metadata returned by the overlay fetch */
export interface ProductFulfillment {
  productId: string;
  availableFulfillmentTypes: string[];
  pickupOnly: boolean;
}
