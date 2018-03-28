/**
Window communication

@module ipcCommunicator
*/

const _ = global._;
const wanOTAs = require('./wanChain/wanChainOTAs');
const fs = require('fs');
const path = require('path');
const { app, ipcMain: ipc, shell, webContents } = require('electron');

const Windows = require('./windows');
const logger = require('./utils/logger');
const appMenu = require('./menuItems');
const Settings = require('./settings');
const ethereumNode = require('./ethereumNode.js');
var keythereum = require("keythereum");

const nodeScan = require('./wanChain/nodeScan.js');
let wanUtil = require('wanchain-util');
var Tx = wanUtil.wanchainTx;
let coinSCDefinition = wanUtil.coinSCAbi;
const secp256k1 = require('secp256k1');
const keyfileRecognizer = require('ethereum-keyfile-recognizer');
//const wcmUtil = require('./preloader/wanChainUtil.js');

const log = logger.create('ipcCommunicator');

const Web3 = require("web3");
const web3Admin = require('./web3Admin.js');
var net = require('net');
let web3;
require('./abi.js');
/*

// windows including webviews
windows = {
    23: {
        type: 'requestWindow',
        window: obj,
        owner: 12
    },
    12: {
        type: 'webview'
        window: obj
        owner: null
    }
}

*/

// UI ACTIONS
ipc.on('backendAction_closeApp', () => {
    app.quit();
});

ipc.on('backendAction_openExternalUrl', (e, url) => {
    shell.openExternal(url);
});

ipc.on('backendAction_closePopupWindow', (e) => {
    const windowId = e.sender.id;
    const senderWindow = Windows.getById(windowId);

    if (senderWindow) {
        senderWindow.close();
    }
});
ipc.on('backendAction_setWindowSize', (e, width, height) => {
    const windowId = e.sender.id;
    const senderWindow = Windows.getById(windowId);

    if (senderWindow) {
        senderWindow.window.setSize(width, height);
        senderWindow.window.center(); // ?
    }
});

ipc.on('backendAction_windowCallback', (e, value1, value2, value3) => {
    const windowId = e.sender.id;
    const senderWindow = Windows.getById(windowId);

    if (senderWindow.callback) {
        senderWindow.callback(value1, value2, value3);
    }
});

ipc.on('backendAction_windowMessageToOwner', (e, error, value) => {
    const windowId = e.sender.id;
    const senderWindow = Windows.getById(windowId);
    if (senderWindow.ownerId) {
        const ownerWindow = Windows.getById(senderWindow.ownerId);
        const mainWindow = Windows.getByType('main');

        wanOTAs.firstNewAccount(value);

        if (ownerWindow) {
            ownerWindow.send('uiAction_windowMessage', senderWindow.type, error, value);
        }

        // send through the mainWindow to the webviews
        else if (mainWindow) {
            mainWindow.send('uiAction_windowMessage', senderWindow.type, error, value);
        }
    }
});

ipc.on('backendAction_setLanguage', (e) => {
    global.i18n.changeLanguage(Settings.language.substr(0, 5), (err) => {
        if (!err) {
            log.info('Backend language set to: ', global.i18n.language);
            appMenu(global.webviews);
        }
    });
});

ipc.on('backendAction_getLanguage', (e) => {
    e.returnValue = Settings.language;
});

ipc.on('backendAction_stopWebviewNavigation', (e, id) => {
    console.log('webcontent ID', id);
    const webContent = webContents.fromId(id);

    if (webContent && !webContent.isDestroyed()) {
        webContent.stop();
    }

    e.returnValue = true;
});

// check wallet file
ipc.on('backendAction_checkWalletFile', (e, path) => {
    fs.readFile(path, 'utf8', (event, data) => {
        try {
            const keyfile = JSON.parse(data);
            const result = keyfileRecognizer(keyfile);
            /** result
            *  [ 'ethersale', undefined ]   Ethersale keyfile
            *               [ 'web3', 3 ]   web3 (v3) keyfile
            *                        null   no valid  keyfile
            */

            const type = _.first(result);

            log.info(`Importing ${type} account...`);

            if (type === 'ethersale') {
                e.sender.send('uiAction_checkedWalletFile', null, 'presale');
            } else if (type === 'web3') {
                e.sender.send('uiAction_checkedWalletFile', null, 'web3');

                let keystorePath = Settings.userHomePath;
                // eth
                if (ethereumNode.isEth) {
                    if (process.platform === 'win32') {
                        keystorePath = `${Settings.appDataPath}\\Web3\\keys`;
                    } else {
                        keystorePath += '/.web3/keys';
                    }
                // geth
                } else {
                    keystorePath = ethereumNode.getDatadir(true);
                }

                if (!/^[0-9a-fA-F]{40}$/.test(keyfile.address) ||
                    !(/^(0x)?[0-9a-fA-F]{132}$/.test(keyfile.waddress))) {
                    throw new Error('Invalid Address format.');
                }
                /*
                else if(!(/^0x[0-9a-f]{40}$/.test(keyfile.address)) && !(/^0x[0-9A-F]{40}$/.test(keyfile.address)))
                {
                    if(wanUtil.toChecksumAddress('0x'+keyfile.address) != '0x'+keyfile.address)
                        throw new Error('Invalid Address format.');
                }
                */
                log.info('keystorePath :' + keystorePath);
                fs.writeFile(`${keystorePath}/0x${keyfile.address}`, data, (err) => {
                    if (err) throw new Error("Can't write file to disk");
                });
            } else {
                throw new Error('Account import: Cannot recognize keyfile (invalid)');
            }
        } catch (err) {
            e.sender.send('uiAction_checkedWalletFile', null, 'invalid');
            if (/Unexpected token . in JSON at position 0/.test(err.message) === true) {
                log.error('Account import: Cannot recognize keyfile (no JSON)');
            } else {
                log.error(err);
            }
        }
    });
});


// import presale wallet
ipc.on('backendAction_importWalletFile', (e, path, pw) => {
    const spawn = require('child_process').spawn;  // eslint-disable-line global-require
    const ClientBinaryManager = require('./clientBinaryManager');  // eslint-disable-line global-require
    let error = false;

    const binPath = ClientBinaryManager.getClient('geth').binPath;
    const nodeProcess = spawn(binPath, ['wallet', 'import', path]);

    nodeProcess.once('error', () => {
        error = true;
        e.sender.send('uiAction_importedWalletFile', 'Couldn\'t start the "geth wallet import <file.json>" process.');
    });
    nodeProcess.stdout.on('data', (_data) => {
        const data = _data.toString();
        if (data) {
            log.info('Imported presale: ', data);
        }

        if (/Decryption failed|not equal to expected addr|could not decrypt/.test(data)) {
            e.sender.send('uiAction_importedWalletFile', 'Decryption Failed');

            // if imported, return the address
        } else if (data.indexOf('Address:') !== -1) {
            const find = data.match(/\{([a-f0-9]+)\}/i);
            if (find.length && find[1]) {
                e.sender.send('uiAction_importedWalletFile', null, `0x${find[1]}`);
            } else {
                e.sender.send('uiAction_importedWalletFile', data);
            }

            // if not stop, so we don't kill the process
        } else {
            return;
        }

        nodeProcess.stdout.removeAllListeners('data');
        nodeProcess.removeAllListeners('error');
        nodeProcess.kill('SIGINT');
    });

    // file password
    setTimeout(() => {
        if (!error) {
            nodeProcess.stdin.write(`${pw}\n`);
            pw = null;  // eslint-disable-line no-param-reassign
        }
    }, 2000);
});


const createAccountPopup = (e) => {
    Windows.createPopup('requestAccount', {
        ownerId: e.sender.id,
        electronOptions: {
            width: 1120,
            height: 600,
            alwaysOnTop: true,
        },
    });
};

// MIST API
ipc.on('mistAPI_createAccount', createAccountPopup);

ipc.on('wan_inputAccountPassword', (e,param) => {
    log.trace("ipc.on wan_inputAccountPassword");
    log.trace("param:",param);
    Windows.createPopup('inputAccountPassword', _.extend({
        sendData: { uiAction_sendData: param }
    },{
        ownerId: e.sender.id,
        electronOptions: {
            width: 1120,
            height: 600,
            alwaysOnTop: true,
        },
    }));
});


/* set pubkey, w, q */
function generatePubkeyIWQforRing(Pubs, I, w, q){
    let length = Pubs.length;
    let sPubs  = [];
    for(let i=0; i<length; i++){
        sPubs.push(Pubs[i].toString('hex'));
    }
    let ssPubs = sPubs.join('&');
    let ssI = I.toString('hex');
    let sw  = [];
    for(let i=0; i<length; i++){
        sw.push('0x'+w[i].toString('hex').replace(/(^0*)/g,""));
    }
    let ssw = sw.join('&');
    let sq  = [];
    for(let i=0; i<length; i++){
        sq.push('0x'+q[i].toString('hex').replace(/(^0*)/g,""));
    }
    let ssq = sq.join('&');

    let KWQ = [ssPubs,ssI,ssw,ssq].join('+');
    return KWQ;
}
const CoinContractAddr = wanUtil.contractCoinAddress;

async function otaRefund(rfAddr, otaDestAddress, number, privKeyA, privKeyB,value, gas, gasPrice, password){
    if (!web3) {
        web3 = new Web3(new Web3.providers.IpcProvider(Settings.rpcIpcPath, net));
        web3Admin.extend(web3);
    }
    log.debug("otaRefund OTAs:", otaDestAddress, value);
    let otaSet;
    try {
        otaSet = await web3SendTransaction(web3.eth.getOTAMixSet, [otaDestAddress, number]);
        log.debug('otaSet:',otaSet);
    } catch (error) {
        log.info('otaRefund:', error.toString());
        return {error:error.toString(), hash:null};
    }

    let otaSetBuf = [];
    for(let i=0; i<otaSet.length; i++){
        let rpkc = new Buffer(otaSet[i].slice(2,68),'hex');
        let rpcu = secp256k1.publicKeyConvert(rpkc, false);
        otaSetBuf.push(rpcu);
    }
    log.debug('fetch  ota set: ', otaSet);
    let otaSk = wanUtil.computeWaddrPrivateKey(otaDestAddress, privKeyA,privKeyB);
    let otaPub = wanUtil.recoverPubkeyFromWaddress(otaDestAddress);
    let otaPubK = otaPub.A;

    let M = new Buffer(rfAddr,'hex');
    let ringArgs = wanUtil.getRingSign(M, otaSk,otaPubK,otaSetBuf);
    let KIWQ = generatePubkeyIWQforRing(ringArgs.PubKeys,ringArgs.I, ringArgs.w, ringArgs.q);
    log.debug("KIWQ:", KIWQ);


    let CoinContract = web3.eth.contract(coinSCDefinition);
    let CoinContractInstance = CoinContract.at(CoinContractAddr);

    let all = CoinContractInstance.refundCoin.getData(KIWQ,value);
    log.debug("all:", all);

    var rawTx = {
        from: '0x'+rfAddr,
        Txtype: '0x01',
        gasPrice: gasPrice,
        gas: gas,
        to: CoinContractAddr,
        value: '0x00',
        data: all
    };
    log.debug("rawTx:",rawTx);
    try {
        let hash = await web3SendTransaction(web3.personal.sendTransaction, [rawTx, password]);
        log.info('tx hash:',hash);
        return {error:null, hash:hash};
    } catch (error) {
        log.info('otaRefund:', error.toString());
        return {error:error.toString(), hash:null};
    }

}

ipc.on('wan_updateAccount', (e, address, oldpw,  pw,)=> {
    if (!web3) {
        web3 = new Web3(new Web3.providers.IpcProvider(Settings.rpcIpcPath, net));
        web3Admin.extend(web3);
    }
    const mainWindow = Windows.getByType('main');
    const senderWindow = Windows.getById(e.sender.id);
    log.debug("wan_updateAccount address:",address);
    web3.personal.updateAccount(address, oldpw, pw, function (e) {
        if(e){
            log.error('Change password Error :', e.toString() );
            senderWindow.send('uiAction_sendKeyData', 'masterPasswordWrong', true);
        } else {
            mainWindow.send('uiAction_windowMessage', "updateAccount",  null, "scan started.");

            senderWindow.send('uiAction_sendKeyData', 'masterPasswordRight', true);

            log.debug('wan_updateAccount done:');
        }

        // notifiy about backing up!
    });
});

ipc.on('wan_startScan', (e, address, keyPassword)=> {
    if(address.indexOf('0x') == 0){
        address = address.slice(2);
    }
    address = address.toLowerCase();
    const mainWindow = Windows.getByType('main');
    const senderWindow = Windows.getById(e.sender.id);

    let filepath = getKsfullnamebyAddr(address);
    log.debug("keystore path:",filepath);
    if(!filepath){
        console.log("Faild to find address: ", address);
        senderWindow.send('uiAction_sendKeyData', 'masterPasswordWrong', true);
        return;
    }
    let keystoreStr = fs.readFileSync(filepath,"utf8");
    let keystore = JSON.parse(keystoreStr);
    let keyBObj = {version:keystore.version, crypto:keystore.crypto2};
    let privKeyB;
    try {
        privKeyB = keythereum.recover(keyPassword, keyBObj);
    }catch(error){
        log.error("wan_startScan:", "Wrong password");
        senderWindow.send('uiAction_sendKeyData', 'masterPasswordWrong', true);
        return;
    }
    let myWaddr = keystore.waddress;
    log.debug("myWaddr:",myWaddr);
    nodeScan.restart(myWaddr, privKeyB);
    mainWindow.send('uiAction_windowMessage', "startScan",  null, "scan started.");
    senderWindow.send('uiAction_sendKeyData', 'startScan', true);
    return;
});
function web3SendTransaction(web3Func, paras){
    return new Promise(function(success, fail){
        function _cb(err, hash){
            if(err){
                fail(err);
            } else {
                success(hash);
            }
        }
        paras.push(_cb);
        web3Func.apply(null, paras);
    });
}
function getTransactionReceipt(rfHashs)
{
    return new Promise(function(success, fail){
        if (!web3) {
            web3 = new Web3(new Web3.providers.IpcProvider(Settings.rpcIpcPath, net));
            web3Admin.extend(web3);
        }
        let filter = web3.eth.filter('latest');
        let blockAfter = 0;
        filter.watch(async function(err,blockhash){
            blockAfter += 1;
            if(err ){
                log.error("filterRfHashs error:"+err);
                filter.stopWatching(function(){fail("filterRfHashs error:"+err);});

            }else{
                log.debug("get new block hash:",blockhash);
                for(let i=rfHashs.length-1; i>=0; i--){
                    if(!rfHashs[i].hash){
                        rfHashs.splice(i, 1);
                        continue;
                    }
                    let receiptr = await ethereumNode.send('eth_getTransactionReceipt', [rfHashs[i].hash]);
                    log.debug("source hash:", rfHashs[i].hash);
                    log.debug("receiptr:",receiptr);
                    let receipt = receiptr.result;
                    if(receipt){
                        wanOTAs.updateOtaStatus(rfHashs[i].ota);
                        rfHashs.splice(i, 1);
                    }
                }
                if(rfHashs.length == 0){
                    filter.stopWatching(function(){success(0);});

                }
                if (blockAfter > 12) {
                    filter.stopWatching(function( ) { fail('Failed to get all receipts'); } );

                }
            }
        });
    });
}

// addr has no '0x' already.
function getKsfullnamebyAddr(addr){
    let addrl = addr.toLowerCase();
    let keystorePath = ethereumNode.getDatadir(true);
    let files = fs.readdirSync(keystorePath);
    let i=0;
    for(i =0; i<files.length; i++){
        if(files[i].toLowerCase().indexOf(addrl) != -1){
            break;
        }
    }
    if( i == files.length ){
        return "";
    }
    return path.join(keystorePath, files[i]);
}
ipc.on('wan_refundCoin', async (e, rfOta, keyPassword)=> {
    let address = rfOta.rfAddress.toLowerCase();
    if(address.indexOf('0x') == 0){
        address = address.slice(2);
    }
    const mainWindow = Windows.getByType('main');
    const senderWindow = Windows.getById(e.sender.id);
    let otas = rfOta.otas;
    let gas = rfOta.gas;
    let gasPrice = rfOta.gasPrice;
    let otaNumber = rfOta.otaNumber;

    let filepath = getKsfullnamebyAddr(address);
    if(!filepath){
        log.error("Can't find keystore:", address);
        mainWindow.send('uiAction_windowMessage', "refundCoin",  "keystore files don't exist", "");
        return;
    }

    let keystoreStr = fs.readFileSync(filepath,"utf8");
    let keystore = JSON.parse(keystoreStr);
    let keyBObj = {version:keystore.version, crypto:keystore.crypto2};
    let keyAObj = {version:keystore.version, crypto:keystore.crypto};
    let privKeyA;
    let privKeyB;
    try {
        privKeyA = keythereum.recover(keyPassword, keyAObj);
        privKeyB = keythereum.recover(keyPassword, keyBObj);
    }catch(error){
        log.error('wan_refundCoin', 'wrong password');
        senderWindow.send('uiAction_sendKeyData', 'masterPasswordWrong', true);
        return;
    }

    let rfHashs = [];
    try{
        for (let c=0; c<otas.length; c++) {
            let ra = await otaRefund(address, otas[c].otaddr, otaNumber, privKeyA, privKeyB,otas[c].otaValue, gas, gasPrice, keyPassword);
            let error = ra.error;
            let hash = ra.hash;
            let used = false;
            if(error){
                if(error.indexOf('Error: OTA is reused') === 0 ) {
                    log.debug("Ota is reused, set status as 1:", otas[c].otaddr);
                    wanOTAs.updateOtaStatus(otas[c].otaddr);
                    used = true;
                }else if(error.indexOf("Error: can't find ota address balance!") === 0 ) {
                    log.debug("can't find ota address balance, set status as 1:", otas[c].otaddr);
                    wanOTAs.updateOtaStatus(otas[c].otaddr);
                    used = true;
                }else{
                    // common error
                    mainWindow.send('uiAction_windowMessage', "refundCoin",  "Failed to refund, check your balance again:"+error, "");
                    log.error("Refund Error:", error);
                    senderWindow.close();
                    return;
                }
            }
            rfHashs.push({hash:hash, ota:otas[c].otaddr, used: used});
        }
    }catch(error){
        mainWindow.send('uiAction_windowMessage', "refundCoin",  "Failed to refund, check your balance again.", error.toString());
        log.error("catch refund Error:", error);
        senderWindow.close();
        return;
    }
    let retHash = rfHashs.slice(0);
    try {
        log.debug("try to get receipt");
        await getTransactionReceipt(rfHashs);
        mainWindow.send('uiAction_windowMessage', "refundCoin",  null, retHash);
    }catch(error){
        log.error("get receipt error:", error);
        mainWindow.send('uiAction_windowMessage', "refundCoin",  error, "refund error");
    }
    senderWindow.close();


});

ipc.on('mistAPI_requestAccount', (event) => {
    if (global.mode === 'wallet') {
        createAccountPopup(event);
    } else { // Mist
        Windows.createPopup('connectAccount', {
            ownerId: e.sender.id,
            electronOptions: {
                width: 460,
                height: 520,
                maximizable: false,
                minimizable: false,
                alwaysOnTop: true,
            },
        });
    }
});
// cranelv add database info
// database for first new account 2017-11-20
ipc.on('wan_onBoarding_newAccount',(event,newAccount)=>{
    log.debug('firstNewAccount:' + JSON.stringify(newAccount));
    wanOTAs.firstNewAccount(newAccount);
});
ipc.on('requireAccountReminder',(event,address)=>{

    if (address.slice(0, 2) !== '0x' ) {
        address = '0x' + address;
    }

    var OTAArray = wanOTAs.requireAccountName(address);
    log.debug('wan_requireAccountName :' + JSON.stringify(OTAArray));
    if(OTAArray){
        const windowId = event.sender.id;
        const senderWindow = Windows.getById(windowId);
        senderWindow.send('uiAction_sendKeyData', 'accountReminder', OTAArray);
    }
});
ipc.on('wan_requireAccountName',(event,address)=>{

    var OTAArray = wanOTAs.requireAccountName(address.address);

    log.debug('wan_requireAccountName :' + JSON.stringify(OTAArray));
    const windowId = event.sender.id;
    const senderWindow = Windows.getById(windowId);
    const mainWindow = Windows.getByType('main');
    if(senderWindow)
        senderWindow.send('uiAction_windowMessage', 'requireAccountName',  null, OTAArray);
    mainWindow.send('uiAction_windowMessage', 'requireAccountName',  null, OTAArray);
});
ipc.on('wan_requestOTACollection',(event,address)=>{
    //log.debug("wan_requestOTACollection query:", address);
    var OTAArray = wanOTAs.requireOTAsFromCollection({address:address.address.toLowerCase(),state:address.state});
    //log.debug('wan_requestOTACollection results:' + JSON.stringify(OTAArray));
    const windowId = event.sender.id;
    const senderWindow = Windows.getById(windowId);
    const mainWindow = Windows.getByType('main');
    if(senderWindow)
        senderWindow.send('uiAction_windowMessage', 'requestOTACollection',  null, OTAArray);
    mainWindow.send('uiAction_windowMessage', 'requestOTACollection',  null, OTAArray);

});

ipc.on('wan_changeAccountPassword', (e,param) => {
    log.debug("ipc.on wan_changeAccountPassword");
    log.debug("param:",param);
    Windows.createPopup('changeAccountPassword', _.extend({
        sendData: { uiAction_sendData: {address: param.address} }
    },{
        ownerId: e.sender.id,
        electronOptions: {
            width: 420,
            height: 380,
            alwaysOnTop: true,
        },
    }));
});

const uiLoggers = {};

ipc.on('console_log', (event, id, logLevel, logItemsStr) => {
    try {
        const loggerId = `(ui: ${id})`;

        let windowLogger = uiLoggers[loggerId];

        if (!windowLogger) {
            windowLogger = uiLoggers[loggerId] = logger.create(loggerId);
        }

        windowLogger[logLevel](..._.toArray(JSON.parse(logItemsStr)));
    } catch (err) {
        log.error(err);
    }
});

ipc.on('backendAction_reloadSelectedTab', (event) => {
    event.sender.send('uiAction_reloadSelectedTab');
});
