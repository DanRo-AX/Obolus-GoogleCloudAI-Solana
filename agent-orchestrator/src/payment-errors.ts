export class PayShPaymentNotSentError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'PayShPaymentNotSentError'
  }
}
