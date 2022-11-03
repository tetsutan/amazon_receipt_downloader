const readLineSync = require("readline-sync");
const fs = require('fs');
const exec = require('child_process').exec;

const puppeteer = require('puppeteer');

let year = '2020';
if(process.argv.length > 2) {
  year = process.argv[2];
}

if(! /^[0-9]+$/.test(year)) {
  console.log("argument error")
  return
}

const url = 'https://www.amazon.co.jp/gp/your-account/order-history?opt=ab&digitalOrders=1&unifiedOrders=1&orderFilter=year-' + year;

const cookie_path = './cookie.txt';


function log(message) {
  console.log("[" + new Date().toLocaleString() + "] "+ message)
}

(async function(){

  // cookie
  let cookie_exist = false
  try{
    fs.statSync(cookie_path)
    cookie_exist = true
  }catch(e){
    log(e.message)
  }

  if(!cookie_exist) {

    // 初回ログイン
    log("First login")
    const _browser = await puppeteer.launch({headless: false});
    const _page = await _browser.newPage();
    await _page.goto(url);

    while(_page.url().match(/^https:\/\/www\.amazon\.co\.jp\/ap\/signin/) || _page.url().match(/^https:\/\/www\.amazon\.co\.jp\/ap\/mfa/)){
      await _page.waitForTimeout(500);
    }

    log("Find your orders")
    await _page.waitForSelector("#yourOrders");

    let cookies = await _page.cookies();
    fs.writeFileSync(cookie_path, JSON.stringify(cookies));
    log("Re-run this")
    await _browser.close();
    return
  }

  log("Cookies found")

  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  let cookies = JSON.parse(fs.readFileSync(cookie_path, 'utf-8'));
  for (let cookie of cookies) {
    await page.setCookie(cookie);
  }

  log("Find your orders")
  await page.goto(url);
  await page.waitForSelector("#yourOrders");

  if(page.url().match(/^https:\/\/www\.amazon\.co\.jp\/ap\/signin/)) {
    fs.unlinkSync(cookie_path);
    log("Re-run this")
    await browser.close();
    return
  }


  // let html = await page.evaluate(() => { return document.getElementsByTagName('html')[0].innerHTML });
  // await fs.writeFileSync('page.html', html);


  log("Get invoice urls")
  have_next_page = true
  let invoice_urls = []
  let index = 10
  while(have_next_page) {
    let _urls = await page.evaluate(() => { return Array.from(document.querySelectorAll('span.hide-if-js a')).map(x => x.href) });
    have_next_page = _urls.length == 10
    // console.log(_urls.length)
    Array.prototype.push.apply(invoice_urls, _urls);

    await page.goto(url + '&startIndex=' + index)
    await page.waitForTimeout(500)
    index += 10

  }

  log("Receive "+invoice_urls.length+" invoices rendering")
  let invoice_index = 0;

  for(const url of invoice_urls) {

    // skip count
    // if(invoice_index < 80) {
    //   invoice_index++;
    //   continue;
    // }

    await page.goto(url).catch(e => {
      log("error: invoice_index = " + invoice_index)
      log(e.message)
    })
    await page.waitForTimeout(500)

    let filename_index = invoice_urls.length - invoice_index
    let pad_filename_index = ( '0000' + filename_index ).slice( -4 );
    await page.pdf({path: 'invoice-' + year + '-' + pad_filename_index + '.pdf' , format: 'A4'});

    invoice_index++

    if(invoice_index % 10 == 0) {
      log("Rendered " + invoice_index + "/" + invoice_urls.length + " pdfs")
    }


  }
  log("Rendered all pdfs")

  await browser.close();
})();

