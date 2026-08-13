import {
  DOMParser, XMLSerializer,
  type Document as XmlDocument,
  type Element as XmlElement,
  type Node as XmlNode,
} from '@xmldom/xmldom'
import { deflateSync } from 'fflate'
import { Context } from 'hono'
import { env } from 'hono/adapter'
import { SignedXml } from 'xml-crypto'
import * as xmlEncryption from 'xml-encryption'
import {
  adapterConfig, errorConfig, messageConfig, routeConfig, typeConfig,
} from '../configs'
import { samlIdpModel } from '../models'
import { loggerUtil } from '../utils'

const XML_SIGNATURE_NAMESPACE = 'http://www.w3.org/2000/09/xmldsig#'
const SAML_SUCCESS = 'urn:oasis:names:tc:SAML:2.0:status:Success'
const REDIRECT_BINDING = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect'
const POST_BINDING = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST'
const ALLOWED_SIGNATURE_METHODS = new Set([
  'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
  'http://www.w3.org/2001/04/xmldsig-more#rsa-sha512',
])
const ALLOWED_DIGEST_METHODS = new Set([
  'http://www.w3.org/2001/04/xmlenc#sha256',
  'http://www.w3.org/2001/04/xmlenc#sha512',
])
const ALLOWED_CONTENT_ENCRYPTION = new Set([
  'http://www.w3.org/2001/04/xmlenc#aes128-cbc',
  'http://www.w3.org/2001/04/xmlenc#aes256-cbc',
  'http://www.w3.org/2009/xmlenc11#aes128-gcm',
  'http://www.w3.org/2009/xmlenc11#aes256-gcm',
])
const ALLOWED_KEY_ENCRYPTION = new Set([
  'http://www.w3.org/2001/04/xmlenc#rsa-oaep-mgf1p',
  'http://www.w3.org/2009/xmlenc11#rsa-oaep',
])

type IdentityProvider = {
  entityId: string;
  ssoUrl: string;
  signingCertificates: string[];
}

type SamlExtract = {
  response: {
    id: string;
    inResponseTo: string;
    destination: string;
  };
  audience: string[];
  conditions: {
    notBefore: string;
    notOnOrAfter: string;
  };
  attributes: Record<string, string | string[]>;
}

export const getSpEntityId = (c: Context<typeConfig.Context>) => {
  const { AUTH_SERVER_URL: serverUri } = env(c)
  return `${serverUri}${routeConfig.InternalRoute.SamlSp}/metadata`
}

export const getSpAcsUrl = (c: Context<typeConfig.Context>) => {
  const { AUTH_SERVER_URL: serverUri } = env(c)
  return `${serverUri}${routeConfig.InternalRoute.SamlSp}/acs`
}

export const createSp = async (c: Context<typeConfig.Context>) => {
  const certificate = await c.env.KV.get(adapterConfig.BaseKVKey.SamlSpCert)
  const privateKey = await c.env.KV.get(adapterConfig.BaseKVKey.SamlSpKey)
  if (!certificate || !privateKey) {
    throw new errorConfig.InternalServerError(messageConfig.ConfigError.NoSpSecret)
  }

  return {
    getMetadata: () => spMetadata(
      getSpEntityId(c),
      getSpAcsUrl(c),
      certificate,
    ),
    createLoginRequest: async (idp: IdentityProvider, _binding?: 'redirect') => {
      const id = `_${crypto.randomUUID()}`
      const issueInstant = new Date().toISOString()
      const request = [
        `<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"`,
        ` xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"`,
        ` ID="${escapeXml(id)}" Version="2.0" IssueInstant="${escapeXml(issueInstant)}"`,
        ` Destination="${escapeXml(idp.ssoUrl)}"`,
        ` AssertionConsumerServiceURL="${escapeXml(getSpAcsUrl(c))}"`,
        ` ProtocolBinding="${POST_BINDING}">`,
        `<saml:Issuer>${escapeXml(getSpEntityId(c))}</saml:Issuer>`,
        '<samlp:NameIDPolicy Format="urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified" AllowCreate="true"/>',
        '</samlp:AuthnRequest>',
      ].join('')
      const compressed = deflateSync(new TextEncoder().encode(request), { level: 6 })
      const url = new URL(idp.ssoUrl)
      url.searchParams.set('SAMLRequest', bytesToBase64(compressed))
      return {
        id,
        context: url.toString(),
      }
    },
    parseLoginResponse: async (
      idp: IdentityProvider,
      _binding: 'post',
      input: { body: Record<string, unknown> },
    ): Promise<{ extract: SamlExtract }> => {
      const encoded = input.body.SAMLResponse
      if (typeof encoded !== 'string' || encoded.length === 0 || encoded.length > 2_800_000) {
        throw new Error('saml_response_invalid')
      }
      const xml = new TextDecoder().decode(base64ToBytes(encoded.replaceAll(' ', '+')))
      const extract = await verifyAndExtract(
        xml,
        idp,
        privateKey,
      )
      return { extract }
    },
  }
}

export const loadIdp = async (
  c: Context<typeConfig.Context>,
  name: string,
  appId?: number,
) => {
  const idpRecord = await samlIdpModel.getByName(
    c.env.DB,
    name,
  )
  if (!idpRecord || !idpRecord.isActive) {
    loggerUtil.triggerLogger(
      c,
      loggerUtil.LoggerLevel.Warn,
      messageConfig.RequestError.NoSamlIdp,
    )
    throw new errorConfig.NotFound(messageConfig.RequestError.NoSamlIdp)
  }
  if (appId) {
    const appRealm = await c.env.DB.prepare(
      `SELECT project_id FROM identity_app_realm
       WHERE realm=? AND melody_app_id=? LIMIT 1`,
    ).bind(
      c.env.IDENTITY_REALM,
      appId,
    ).first<{ project_id: number | null }>()
    if (appRealm?.project_id) {
      const scoped = await c.env.DB.prepare(
        `SELECT resource_id FROM identity_admin_resource_scope
         WHERE realm=? AND project_id=? AND resource_type='saml_idp'
           AND resource_id=? LIMIT 1`,
      ).bind(
        c.env.IDENTITY_REALM,
        appRealm.project_id,
        idpRecord.id,
      ).first()
      if (!scoped) throw new errorConfig.NotFound(messageConfig.RequestError.NoSamlIdp)
    }
  }
  const provider = parseIdentityProviderMetadata(idpRecord.metadata)
  return {
    provider,
    record: idpRecord,
  }
}

function spMetadata (
  entityId: string,
  acsUrl: string,
  certificate: string,
): string {
  const x509 = certificate
    .replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s/g, '')
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${escapeXml(entityId)}">`,
    '<md:SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="true" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">',
    '<md:KeyDescriptor use="signing"><ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:X509Data>',
    `<ds:X509Certificate>${x509}</ds:X509Certificate>`,
    '</ds:X509Data></ds:KeyInfo></md:KeyDescriptor>',
    '<md:KeyDescriptor use="encryption"><ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:X509Data>',
    `<ds:X509Certificate>${x509}</ds:X509Certificate>`,
    '</ds:X509Data></ds:KeyInfo></md:KeyDescriptor>',
    `<md:AssertionConsumerService Binding="${POST_BINDING}" Location="${escapeXml(acsUrl)}" index="0" isDefault="true"/>`,
    '</md:SPSSODescriptor></md:EntityDescriptor>',
  ].join('')
}

function parseIdentityProviderMetadata (metadata: string): IdentityProvider {
  const doc = parseXml(metadata)
  const descriptor = allElements(doc, 'EntityDescriptor').find((candidate) =>
    allElements(candidate, 'IDPSSODescriptor').length > 0)
  if (!descriptor) throw new Error('saml_idp_metadata_invalid')
  const entityId = descriptor.getAttribute('entityID')?.trim() ?? ''
  const idpDescriptor = allElements(descriptor, 'IDPSSODescriptor')[0]
  const services = allElements(idpDescriptor, 'SingleSignOnService')
  const service = services.find((candidate) => candidate.getAttribute('Binding') === REDIRECT_BINDING) ?? services[0]
  const ssoUrl = service?.getAttribute('Location')?.trim() ?? ''
  const signingCertificates = allElements(idpDescriptor, 'KeyDescriptor')
    .filter((key) => (key.getAttribute('use') ?? 'signing') !== 'encryption')
    .flatMap((key) => allElements(key, 'X509Certificate')) // gitleaks:allow -- XML element name, never key material
    .map((node) => node.textContent?.replace(/\s/g, '') ?? '')
    .filter(Boolean)
    .map(toCertificatePem)
  if (!entityId || !isHttpsUrl(ssoUrl) || signingCertificates.length === 0) {
    throw new Error('saml_idp_metadata_invalid')
  }
  return {
    entityId,
    ssoUrl,
    signingCertificates,
  }
}

async function verifyAndExtract (
  xml: string,
  idp: IdentityProvider,
  privateKey: string,
): Promise<SamlExtract> {
  const original = parseXml(xml)
  assertUniqueIds(original)

  let authenticated = verifySignedDocuments(
    xml,
    original,
    idp.signingCertificates,
  )
  if (authenticated.length === 0) throw new Error('saml_signature_required')

  let signedResponse = authenticated.find((doc) => localName(documentRoot(doc)) === 'Response') ?? null
  let signedAssertion = authenticated.find((doc) => localName(documentRoot(doc)) === 'Assertion') ?? null

  if (signedResponse && !signedAssertion) {
    signedAssertion = await assertionFromAuthenticatedResponse(
      signedResponse,
      privateKey,
      idp.signingCertificates,
    )
  }
  if (!signedAssertion) {
    const decrypted = await decryptAssertionFromDocument(
      original,
      privateKey,
    )
    if (decrypted) {
      assertUniqueIds(decrypted)
      authenticated = verifySignedDocuments(
        new XMLSerializer().serializeToString(decrypted),
        decrypted,
        idp.signingCertificates,
      )
      signedAssertion = authenticated.find((doc) => localName(documentRoot(doc)) === 'Assertion') ?? null
    }
  }
  if (!signedAssertion) throw new Error('saml_assertion_signature_required')

  const assertion = documentRoot(signedAssertion)
  const issuer = firstText(assertion, 'Issuer')
  if (issuer !== idp.entityId) throw new Error('saml_issuer_invalid')
  if (signedResponse) assertSuccessStatus(signedResponse)

  const subjectConfirmation = allElements(assertion, 'SubjectConfirmationData')[0]
  const conditions = allElements(assertion, 'Conditions')[0]
  const authnStatement = allElements(assertion, 'AuthnStatement')[0]
  const inResponseTo = subjectConfirmation?.getAttribute('InResponseTo')?.trim() ??
    (signedResponse ? documentRoot(signedResponse).getAttribute('InResponseTo')?.trim() : '') ?? ''
  const destination = subjectConfirmation?.getAttribute('Recipient')?.trim() ??
    (signedResponse ? documentRoot(signedResponse).getAttribute('Destination')?.trim() : '') ?? ''
  const notBefore = conditions?.getAttribute('NotBefore')?.trim() ?? ''
  const expirations = [
    conditions?.getAttribute('NotOnOrAfter')?.trim(),
    subjectConfirmation?.getAttribute('NotOnOrAfter')?.trim(),
    authnStatement?.getAttribute('SessionNotOnOrAfter')?.trim(),
  ].filter((value): value is string => Boolean(value))
  const notOnOrAfter = earliestTimestamp(expirations)
  validateTimeWindow(
    notBefore,
    notOnOrAfter,
  )

  const audience = allElements(assertion, 'Audience')
    .map((element) => element.textContent?.trim() ?? '')
    .filter(Boolean)
  const attributes: Record<string, string | string[]> = {}
  for (const attribute of allElements(assertion, 'Attribute')) {
    const name = attribute.getAttribute('Name')?.trim()
    if (!name) continue
    const values = allElements(attribute, 'AttributeValue')
      .map((element) => element.textContent?.trim() ?? '')
      .filter(Boolean)
    if (values.length > 0) attributes[name] = values.length === 1 ? values[0] : values
  }
  const nameId = firstText(assertion, 'NameID')
  if (nameId) {
    attributes.NameID = nameId
    attributes.nameId = nameId
  }

  return {
    response: {
      id: assertion.getAttribute('ID')?.trim() ?? '',
      inResponseTo,
      destination,
    },
    audience,
    conditions: {
      notBefore,
      notOnOrAfter,
    },
    attributes,
  }
}

function verifySignedDocuments (
  xml: string,
  doc: XmlDocument,
  certificates: string[],
): XmlDocument[] {
  const authenticated: XmlDocument[] = []
  const signatures = allElements(doc, 'Signature')
    .filter((node) => node.namespaceURI === XML_SIGNATURE_NAMESPACE)
  for (const signature of signatures) {
    assertStrongSignatureAlgorithms(signature)
    for (const certificate of certificates) {
      try {
        const verifier = new SignedXml({
          publicCert: certificate,
          getCertFromKeyInfo: () => null,
        })
        verifier.loadSignature(signature as unknown as globalThis.Node)
        if (!verifier.checkSignature(xml)) continue
        for (const signed of verifier.getSignedReferences()) {
          const signedDoc = parseXml(signed)
          const rootName = localName(documentRoot(signedDoc))
          if (rootName === 'Response' || rootName === 'Assertion') authenticated.push(signedDoc)
        }
        break
      } catch {
        // Another configured signing certificate may be active during IdP rotation.
      }
    }
  }
  return authenticated
}

async function assertionFromAuthenticatedResponse (
  response: XmlDocument,
  privateKey: string,
  certificates: string[],
): Promise<XmlDocument | null> {
  const assertions = allElements(response, 'Assertion')
  if (assertions.length === 1) return documentFromElement(assertions[0])
  if (assertions.length > 1) throw new Error('saml_assertion_ambiguous')
  const decrypted = await decryptAssertionFromDocument(
    response,
    privateKey,
  )
  if (!decrypted) return null
  const signed = verifySignedDocuments(
    new XMLSerializer().serializeToString(decrypted),
    decrypted,
    certificates,
  ).find((doc) => localName(documentRoot(doc)) === 'Assertion')
  return signed ?? decrypted
}

async function decryptAssertionFromDocument (
  doc: XmlDocument,
  privateKey: string,
): Promise<XmlDocument | null> {
  const encryptedAssertions = allElements(doc, 'EncryptedAssertion')
  if (encryptedAssertions.length === 0) return null
  if (encryptedAssertions.length !== 1) throw new Error('saml_encrypted_assertion_ambiguous')
  const encryptedData = allElements(encryptedAssertions[0], 'EncryptedData')[0]
  const contentAlgorithm = allElements(encryptedData, 'EncryptionMethod')[0]?.getAttribute('Algorithm') ?? ''
  const encryptedKey = allElements(encryptedData, 'EncryptedKey')[0] ?? allElements(encryptedAssertions[0], 'EncryptedKey')[0]
  const keyAlgorithm = encryptedKey
    ? allElements(encryptedKey, 'EncryptionMethod')[0]?.getAttribute('Algorithm') ?? ''
    : ''
  if (!ALLOWED_CONTENT_ENCRYPTION.has(contentAlgorithm) || !ALLOWED_KEY_ENCRYPTION.has(keyAlgorithm)) {
    throw new Error('saml_encryption_algorithm_invalid')
  }
  const encryptedXml = new XMLSerializer().serializeToString(encryptedData)
  const decrypted = await new Promise<string>((resolve, reject) => {
    xmlEncryption.decrypt(
      encryptedXml,
      {
        key: privateKey,
        disallowDecryptionWithInsecureAlgorithm: false,
        warnInsecureAlgorithm: false,
      },
      (error, result) => error ? reject(error) : resolve(result),
    )
  })
  const assertion = parseXml(decrypted)
  if (localName(documentRoot(assertion)) !== 'Assertion') throw new Error('saml_decrypted_assertion_invalid')
  return assertion
}

function assertSuccessStatus (response: XmlDocument): void {
  const statusCode = allElements(response, 'StatusCode')[0]?.getAttribute('Value')?.trim() ?? ''
  if (statusCode !== SAML_SUCCESS) throw new Error('saml_status_invalid')
}

function assertStrongSignatureAlgorithms (signature: XmlElement): void {
  const signatureMethod = allElements(signature, 'SignatureMethod')[0]?.getAttribute('Algorithm') ?? ''
  if (!ALLOWED_SIGNATURE_METHODS.has(signatureMethod)) throw new Error('saml_signature_algorithm_invalid')
  const digests = allElements(signature, 'DigestMethod')
  if (digests.length === 0 || digests.some((digest) => !ALLOWED_DIGEST_METHODS.has(digest.getAttribute('Algorithm') ?? ''))) {
    throw new Error('saml_digest_algorithm_invalid')
  }
}

function assertUniqueIds (doc: XmlDocument): void {
  const ids = new Set<string>()
  for (const element of allElements(doc)) {
    for (const attribute of ['ID', 'Id', 'id']) {
      const value = element.getAttribute(attribute)
      if (!value) continue
      if (ids.has(value)) throw new Error('saml_duplicate_id')
      ids.add(value)
    }
  }
}

function validateTimeWindow (notBefore: string, notOnOrAfter: string): void {
  const now = Date.now()
  const drift = 3_000
  if (notBefore) {
    const timestamp = Date.parse(notBefore)
    if (!Number.isFinite(timestamp) || now + drift < timestamp) throw new Error('saml_assertion_not_active')
  }
  if (!notOnOrAfter) throw new Error('saml_assertion_expiry_required')
  const expiry = Date.parse(notOnOrAfter)
  if (!Number.isFinite(expiry) || now - drift >= expiry) throw new Error('saml_assertion_expired')
}

function earliestTimestamp (values: string[]): string {
  if (values.length === 0) return ''
  return values.reduce((earliest, value) => Date.parse(value) < Date.parse(earliest) ? value : earliest)
}

function parseXml (xml: string): XmlDocument {
  if (!xml || xml.length > 2_100_000 || /<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new Error('saml_xml_invalid')
  }
  return new DOMParser({
    onError: (_level, message) => {
      throw new Error(`saml_xml_invalid:${message}`)
    },
  }).parseFromString(
    xml,
    'application/xml',
  )
}

function documentRoot (doc: XmlDocument): XmlElement {
  if (!doc.documentElement) throw new Error('saml_xml_root_required')
  return doc.documentElement
}

function allElements (root: XmlNode, expectedName?: string): XmlElement[] {
  const result: XmlElement[] = []
  const visit = (node: XmlNode) => {
    if (node.nodeType === 1) {
      const element = node as XmlElement
      if (!expectedName || localName(element) === expectedName) result.push(element)
    }
    for (let index = 0; index < node.childNodes.length; index += 1) {
      visit(node.childNodes[index])
    }
  }
  visit(root)
  return result
}

function localName (element: XmlElement): string {
  return element.localName || element.nodeName.split(':').pop() || ''
}

function firstText (root: XmlNode, name: string): string {
  return allElements(
    root,
    name,
  )[0]?.textContent?.trim() ?? ''
}

function documentFromElement (element: XmlElement): XmlDocument {
  return parseXml(new XMLSerializer().serializeToString(element))
}

function toCertificatePem (base64: string): string {
  return `-----BEGIN CERTIFICATE-----\n${base64.match(/.{1,64}/g)?.join('\n') ?? base64}\n-----END CERTIFICATE-----`
}

function isHttpsUrl (value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function bytesToBase64 (bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes (value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value.replace(/\s/g, ''))) throw new Error('saml_base64_invalid')
  const binary = atob(value.replace(/\s/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function escapeXml (value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}
