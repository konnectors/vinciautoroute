// Force sentry DSN into environment variables
// In the future, will be set by the stack
process.env.SENTRY_DSN =
  process.env.SENTRY_DSN ||
  'https://5a753d9b93f04cb2a9a222624262d1c4:099dbb0b4f244d09b5895d4fec17c434@sentry.cozycloud.cc/39'

const {
  BaseKonnector,
  requestFactory,
  signin,
  scrape,
  saveBills,
  log
} = require('cozy-konnector-libs')
const moment = require('moment')
moment.locale('fr')
const stream = require('stream')
const request = requestFactory({ cheerio: true, jar: true })

const baseUrl = 'https://espaceabonnes.vinci-autoroutes.com'

module.exports = new BaseKonnector(start)

async function start(fields) {
  log('info', 'Authenticating ...')
  await authenticate(fields.login, fields.password)
  log('info', 'Successfully logged in')

  log('info', 'Fetching the list of bills')
  let $ = await request(`${baseUrl}/FacturesConso/Factures`)
  log('info', 'Parsing bills')
  const bills = parseBills($)
  log('info', 'Saving data to Cozy')
  await saveBills(bills, fields.folderPath, {
    identifier: 'vinci',
    contentType: 'application/pdf'
  })
}

async function authenticate(login, password) {
  await signin({
    url: `${baseUrl}/Authentification`,
    formSelector: '#formAuthentication',
    formData: {
      'OpusInternetConnexionModel.NumeroClient': login,
      'OpusInternetConnexionModel.Password': password
    },
    validate: (statusCode, $) => $('#erreurLabel').length === 0
  })
}

function parseBills($) {
  const bills = scrape(
    $,
    {
      fileurl: {
        sel: 'a',
        attr: 'href',
        parse: href => `${baseUrl}${href}`
      },
      idFacture: {
        sel: 'td:nth-child(1)'
      },
      amount: {
        sel: 'td:nth-child(5)',
        parse: amount => parseFloat(amount.replace(' €', '').replace(',', '.'))
      },
      originalDate: {
        sel: 'td:nth-child(3)',
        parse: date => moment(date, 'MMMM YYYY')
      },
      date: {
        sel: 'td:nth-child(7)',
        parse: date => moment(date, 'DD/MM/YYYY').toDate()
      }
    },
    '.table tbody tr'
  )

  return bills.map(bill => {
    const { originalDate, fileurl } = bill
    delete bill.originalDate
    delete bill.fileurl
    const pdfStream = new stream.PassThrough()
    const request = requestFactory({ cheerio: false, json: false })
    const filestream = request(fileurl).pipe(pdfStream)
    return {
      ...bill,
      vendor: 'vinciautoroute',
      currency: '€',
      filestream,
      filename: `${originalDate.format('YYYY-MM')}-${String(
        bill.amount
      ).replace('.', ',')}€.pdf`
    }
  })
}
