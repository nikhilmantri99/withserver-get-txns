// export const hello: APIGatewayProxyHandler = async (event, context) => {
//   return {
//     statusCode: 200,
//     body: JSON.stringify(1,null,2),
//   };
// };
//import { APIGatewayProxyHandler } from "aws-lambda";
import Moralis from "moralis/node.js";
import fetch from "node-fetch";
import AWS from "aws-sdk";
import express from "express";
AWS.config.update({region:'us-east-1'});
const dynamoDb = new AWS.DynamoDB.DocumentClient();
var wallet_processing_set={};
import {fetch_from_url,find_conversion_rate,covalent_logs,etherscan_logs,polygonscan_logs,value_from_hash,transaction_row} from './utils/variouslogs.js';
import {get_image_urls,get_inventory} from './utils/inventory_utils.js';
import {get_metrics_token_wise,get_metrics} from './utils/metric_utils.js';
import { utils } from "@project-serum/anchor";

async function return_NFT_transactions(userid,chain_name,waddress,pg_num=1){
    var to_update=false;
    var curr_txn_list=[];
    var txns_skipped=0;
    var txns_processed=0;
    const get_back = {
        TableName: "lambda-wallet-chain-transactions",
        Key: {
            walletId: waddress,
            chainName: chain_name,        },
    };
    const newResult = await dynamoDb.get(get_back).promise();
    if(newResult!=null && newResult.Item!=null){
        to_update=true;
        curr_txn_list=curr_txn_list.concat(newResult.Item["transactions"]);
        console.log("exists in the table.");
        txns_skipped=newResult.Item["txns_skipped"];
        txns_processed=newResult.Item["txns_processed"];
    }
    var transcations_list=[];
    const serverUrl = "https://kpvcez1i2tg3.usemoralis.com:2053/server";
    const appId = "viZCI1CZimCj22ZTyFuXudn3g0wUnG2pELzPvdg6";
    Moralis.start({ serverUrl, appId });
    var all_transfers=[];
    console.log("fetching...");
    var transfersNFT = await Moralis.Web3API.account.getNFTTransfers({ chain: chain_name, address: waddress, limit: 1});
    var total_nft_transfers_required=transfersNFT.total-(txns_processed+txns_skipped);

    console.log("Required total NFT transfers: ",total_nft_transfers_required);

    var n=0;
    while(all_transfers.length<total_nft_transfers_required){
        console.log("Here");
        transfersNFT = await Moralis.Web3API.account.getNFTTransfers({ chain: chain_name, address: waddress, offset: n*500});
        var cap=500;
        if(total_nft_transfers_required-all_transfers.length<cap){
            cap=total_nft_transfers_required-all_transfers.length;
        }
        all_transfers=all_transfers.concat(transfersNFT.result.slice(0,cap));
        console.log(all_transfers.length);
        n++;
    }
    //console.log(total_nft_transfers_required,all_transfers.length);
    //console.log(all_transfers[0]);
    console.log("For wallet address:",waddress," ,chain: ",chain_name,"total transactions:",all_transfers.length,"\nFollowing are the NFT Transaction values: ");
    let count=0;
    for(let i=0;i<all_transfers.length;i++){
        var txn_row=await transaction_row(all_transfers[i],waddress,chain_name,userid,txns_processed,txns_skipped,count);
        var this_transaction=txn_row[0];
        txns_processed=txn_row[1];
        txns_skipped=txn_row[2];
        count=txn_row[3];
        if(this_transaction!=null) transcations_list.push(this_transaction);
    }

    //update list by also adding existing txns from the table
    if(curr_txn_list.length!=0){
        transcations_list=transcations_list.concat(curr_txn_list);
    }

    const q={chain:chain_name,address: waddress};
    const inventory_NFTS=await Moralis.Web3API.account.getNFTs(q);
    console.log("NFTs in inventory using Moralis: ",inventory_NFTS.result.length);
    var metrics_;
    if(chain_name=="polygon"){
        metrics_=await get_metrics_token_wise(transcations_list,inventory_NFTS.result,null,true);
    }
    else{
        metrics_=await get_metrics_token_wise(transcations_list,inventory_NFTS.result);
    }
    const metrics=metrics_[0];
    const inventory_things=metrics_[1];
    var total_pages;
    if(transcations_list.length%50==0) total_pages= Math.floor(transcations_list.length/50);
    else total_pages= Math.floor(transcations_list.length/50)+1;
    var curr_page=pg_num;
    if(curr_page>total_pages){
        curr_page=total_pages;
    }
    const transactions={
        TableName: get_back.TableName,
        Item: {
            walletId :get_back.Key.walletId,
            chainName : get_back.Key.chainName,
            transactions: transcations_list,
            total_pages: total_pages,
            curr_page: curr_page,
            txns_skipped : txns_skipped,
            txns_processed : txns_processed,
            overall_metrics : metrics["overall_metrics"],
            token_wise_metrics: metrics,
            inventory_NFTS: inventory_things,
        }
    }

    try{
        await dynamoDb.put(transactions).promise();
        const response_body = await dynamoDb.get(get_back).promise();
        var total_len=response_body.Item["transactions"].length;
        if(pg_num>=total_pages) response_body.Item["transactions"]=response_body.Item["transactions"].slice((total_pages-1)*50,total_len);
        else response_body.Item["transactions"]=response_body.Item["transactions"].slice((pg_num-1)*50,pg_num*50);
        return {
            statusCode: 200,
            status: "Success",
            body: response_body,
        };
    }
    catch(e){
        console.log("Error is found....");
        console.log(e);
        return {
            statusCode: 500,
            status: "ERROR",
            body: JSON.stringify({ error: e.message }),
        };
    }
}

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
    var to_process=await ToProcessWallet(wallet,chain_name);
    if(to_process==true){
        try{
            await return_NFT_transactions(userId,chain_name,wallet);
        }
        finally{
            var temp=chain_name.concat(wallet);
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
const port = 3000;


//app.get('/', async(req, res) => {
app.get('/', (req, res) => {
    req.params=params(req);
    console.log(req.params);
    const jsonData= {
        "queryStringParameters":{
            "wallet":req.params.wallet,
            "userid":req.params.userid,
            "chain":req.params.chain
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

