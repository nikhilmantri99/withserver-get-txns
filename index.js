import Moralis from "moralis/node.js";
import fetch from "node-fetch";
import AWS from "aws-sdk";
import express from "express";
AWS.config.update({region:'us-east-1'});
const dynamoDb = new AWS.DynamoDB.DocumentClient();
import {return_NFT_transactions,return_state,fetch_from_url,find_conversion_rate,covalent_logs,etherscan_logs,polygonscan_logs,value_from_hash,transaction_row} from './utils/variouslogs.js';
import {get_image_urls,get_inventory} from './utils/inventory_utils.js';
import {get_metrics_token_wise,get_metrics} from './utils/metric_utils.js';
//import { utils } from "@project-serum/anchor";
import {get_total_pages,put_txns,get_all_txns,get_page_txns,put_inventory,get_all_inventory,get_page_inventory,
        put_tokenwisemetrics,get_all_tokenwisemetrics,get_page_tokenwisemetrics,put_overall_metrics,get_overall_metrics} from "./utils/dynamodb_utils.js";

var wallet_processing_set={};

async function ToProcessWallet(wallet,chain_name){
    var temp=chain_name.concat(wallet);
    if(wallet_processing_set[temp]!=null){
        return false;
    }
    else{
        wallet_processing_set[temp]=1;
        return true;
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
    var to_process=await ToProcessWallet(wallet,chain_name);
    if(to_process==true){
        try{
            await return_NFT_transactions(userId,chain_name,wallet,txn_page,inventory_page,token_page);
        }
        finally{
            var temp=chain_name.concat(wallet);
            console.log("Finished processing the wallet: ",wallet," chain:",chain_name);
            delete wallet_processing_set[temp];
        }
    }
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
const port = 80;

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

