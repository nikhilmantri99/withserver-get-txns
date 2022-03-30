import Moralis from "moralis/node.js";
import fetch from "node-fetch";
import AWS from "aws-sdk";
import express from "express";
AWS.config.update({region:'us-east-1'});
const dynamoDb = new AWS.DynamoDB.DocumentClient();
import {get_size,return_NFT_transactions,return_state,fetch_from_url,find_conversion_rate,covalent_logs,etherscan_logs,polygonscan_logs,value_from_hash,transaction_row} from './utils/variouslogs.js';
import {get_image_urls,get_inventory} from './utils/inventory_utils.js';
import {get_metrics_token_wise,get_metrics} from './utils/metric_utils.js';
//import { utils } from "@project-serum/anchor";
import {get_total_pages,put_txns,get_all_txns,get_page_txns,put_inventory,get_all_inventory,get_page_inventory,
        put_tokenwisemetrics,get_all_tokenwisemetrics,get_page_tokenwisemetrics,put_overall_metrics,get_overall_metrics} from "./utils/dynamodb_utils.js";

var q1=[];
var rq1=[];

var q2=[];
var rq2=[];

var wallet_processing_set={};//to avoid paraller processing of the same wallet

//so three types of wallets: less than 100 txns, more than 100 less than 500 (q1), 500 and above txns (q2)
//small wallet = 0x4958cde93218e9bbeaa922cd9f8b3feec1342772

async function ToProcessWallet(wallet,chain_name){
    var temp=wallet.concat(chain_name);
    if(wallet_processing_set[temp]!=null){
        return false;
    }
    else{
        wallet_processing_set[temp]=1;
        return true;
    }
}

async function process_small_wallets(userId,chain_name,wallet,txn_page,inventory_page,token_page){
    try{
        await return_NFT_transactions(userId,chain_name,wallet,txn_page,inventory_page,token_page);
    }
    finally{
        var temp=req.wallet.concat(req.chain_name);
        console.log("Finished processing the wallet: ",wallet," chain:",chain_name);
        delete wallet_processing_set[temp];
    }
}

async function process_medium_wallets(num_concurrent=2){
    while(q1.length!=0){
        var i=0;
        while (q1.length!=0 && i<num_concurrent){
            rq1.push(q1.shift());
            i++;
        }
        try{
            await Promise.all(rq1.map(async (item) => {
                await return_NFT_transactions(item.userId,item.chain_name,item.wallet,item.txn_page,item.inventory_page,item.token_page);
            }));
        }
        catch(e){
            console.log(e);
        }
        finally{
            while(rq1.length!=0){
                var req=rq1.shift();
                var temp=req.wallet.concat(req.chain_name);
                console.log("Finished processing the wallet: ",req.wallet," chain:",req.chain_name);
                delete wallet_processing_set[temp];
            }
        }
    }
}

async function process_large_wallets(){
    while(q2.length!=0){
        var req=q2.shift();
        rq2.push(req);
        try{
            await return_NFT_transactions(req.userId,req.chain_name,req.wallet,req.txn_page,req.inventory_page,req.token_page);
        }
        finally{
            var temp=req.wallet.concat(req.chain_name);
            console.log("Finished processing the wallet: ",req.wallet," chain:",req.chain_name);
            delete wallet_processing_set[temp];
            rq2.shift();
        }
    }
}

async function process_this_wallet(userId,chain_name,wallet,txn_page,inventory_page,token_page){
    var to_process=await ToProcessWallet(wallet,chain_name);
    var num_size= await get_size(wallet,chain_name);
    var temp=wallet.concat(chain_name);
    var req={
        userId : userId,
        chain_name :chain_name,
        wallet : wallet,
        txn_page : txn_page,
        inventory_page: inventory_page,
        token_page: token_page
    };
    if(to_process==true){
        if(num_size<=50){
            console.log("Wallet Category : Small wallet");
            process_small_wallets(userId,chain_name,wallet,txn_page,inventory_page,token_page);
        }
        else if(num_size>50 && num_size<=650){
            console.log("Wallet Category : Medium wallet");
            if(q1.length==0 && rq1.length==0){
                q1.push(req);
                process_medium_wallets(2);
            }
            else{
                q1.push(req);
            }
        }
        else{
            console.log("Wallet Category : Large wallet");
            if(q2.length==0 && rq2.length==0){
                q2.push(req);
                process_large_wallets();
            }
            else{
                q2.push(req);
            }
        }
    }
}

async function hello(event, context){
    var wallet = event["queryStringParameters"]['wallet'];
    if(wallet==null){
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "No wallet provided." }),
        };
    }
    let userId = event["queryStringParameters"]['userid'];
    if(userId==null){
        userId="1";
    }
    let chain_name= event["queryStringParameters"]['chain'];
    if(chain_name==null){
        chain_name="eth";
    }
    let txn_page=event["queryStringParameters"]['txn_page'];
    if(txn_page==null){
        txn_page=1;
    }
    else{
        txn_page=parseInt(txn_page);
    }
    let inventory_page=event["queryStringParameters"]['inventory_page'];
    if(inventory_page==null){
        inventory_page=1;
    }
    else{
        inventory_page=parseInt(inventory_page);
    }
    let token_page=event["queryStringParameters"]['token_page'];
    if(token_page==null){
        token_page=1;
    }
    else{
        token_page=parseInt(token_page);
    }
    process_this_wallet(userId,chain_name,wallet,txn_page,inventory_page,token_page);
};

var params=function(req){
    let q=req.url.split('?'),result={};
    if(q.length>=2){
        q[1].split('&').forEach((item)=>{
             try {
               result[item.split('=')[0]]=item.split('=')[1];
             } catch (e) {
               result[item.split('=')[0]]='';
             }
        })
    }
    return result;
}

const app = express();
const port = 3000;

//app.get('/', async(req, res) => {
app.get('/', (req, res) => {
    req.params=params(req);
    console.log(req.params);
    const jsonData= {
        "queryStringParameters":{
            "wallet":req.params.wallet,
            "userid":req.params.userid,
            "chain":req.params.chain,
            "txn_page": req.params.txn_page,
            "inventory_page": req.params.inventory_page,
            "token_page": req.params.token_page,
        }
    };
    //const response=await hello(jsonData,'');
    //res.send(response);
    hello(jsonData,'');
    var response= {
        statusCode: 200,
        body:"Wallet is getting updated",
    };
    res.send(response);
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
})

