import DOMPurify, { type Config } from 'dompurify'

const { sanitize, isValidAttribute } = DOMPurify()

export { Config, isValidAttribute }

export default sanitize
