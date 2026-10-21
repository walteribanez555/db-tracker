import { nanoid } from 'nanoid'

export const uid = (prefix = '') => `${prefix}${nanoid(10)}`
