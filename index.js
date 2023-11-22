const readLineSync = require("readline-sync");
const fs = require('fs');
const exec = require('child_process').exec;

const puppeteer = require('puppeteer');





let first_arg = '';
if(process.argv.length > 2) {
  first_arg = process.argv[2];
}

let show_browser = false;
if(first_arg == '-f') {
  show_browser = true;
}

let year = '2020';
const rest_index = show_browser ? 3 : 2;
if(process.argv.length > rest_index) {
  year = process.argv[rest_index];
}


if(! /^[0-9]+$/.test(year)) {
  console.log("argument error")
  return
}

const indexes = process.argv.slice(rest_index+1).map(function(s){ return parseInt(s) });

log(`arguments: year = ${year}, indexes = ${indexes}`)


const url = 'https://www.amazon.co.jp/gp/your-account/order-history?opt=ab&digitalOrders=1&unifiedOrders=1&orderFilter=year-' + year;

const cookie_path = './cookie.txt';


function log(message) {
  console.log("[" + new Date().toLocaleString() + "] "+ message)
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

  const browser = await puppeteer.launch({headless: !show_browser});
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

    let current_index = invoice_index;
    invoice_index++
    let filename_index = invoice_urls.length - current_index; 
    let pad_filename_index = ( '0000' + filename_index ).slice( -4 );




    if(indexes.length == 0 || indexes.includes(current_index)) {
      if(indexes.includes(current_index)) {
        log(`Rendering current_index = ${current_index}`)
      }

      await page.goto(url).catch(e => {
        log(`error: [goto error occured] current_index = ${current_index}, pad_filename_index = ${pad_filename_index}`)
        log(e.message)
      })

      await page.waitForTimeout(500)
      if(page.url().match(/^https:\/\/www\.amazon\.co\.jp\/ap\/signin/)) {
        log(`error: [login-page showed] current_index = ${current_index}, pad_filename_index = ${pad_filename_index}`)

        if(show_browser) {
          log(`input password!`)
          await sleep(20000)
        }
      }


      await page.pdf({path: 'invoice-' + year + '-' + pad_filename_index + '.pdf' , format: 'A4'});

      if(current_index % 10 == 0) {
        log("Rendered " + current_index + "/" + invoice_urls.length + " pdfs")
      }



    }


  }

  log("Rendered all pdfs")

  await browser.close();
})();

