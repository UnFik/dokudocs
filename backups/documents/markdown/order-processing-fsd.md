# Functional Specification: Order Processing Service

## 1. Overview
The Order Processing Service manages cart validation, inventory reservation, payment authorization, and fulfillment dispatch.

## 2. Order States
- **PENDING**: Order placed, waiting for payment confirmation.
- **PAID**: Payment verified by gateway.
- **PROCESSING**: Warehouse allocation underway.
- **SHIPPED**: Courier tracking active.
- **COMPLETED**: Received by customer.

## 3. SLA & Requirements
- Max latency for checkout API: 250ms (p99).
- Webhook retry with exponential backoff up to 5 attempts.