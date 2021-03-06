///////////////////////////////////////////////////
//                      DOM                      //
///////////////////////////////////////////////////

var form = document.getElementById("host-form");
var hostField = document.getElementById("host-field");
var filterField = document.getElementById("filter-field");

// Filter param groups as user types in filter field
filterField.oninput = function(e) {
    filterGroups(filterField.value);
}

// Connect to socket on hostfield enter
form.addEventListener("submit", function(event) {
    event.preventDefault();
    document.activeElement.blur();
    var input = hostField.value;
    if (state == 1) {
        alertify.error("Already trying to connect to a socket");
        return;
    }
    else if (state == 2) {
        socket.close();
    }
    setupSocket(input);
});

// First attempt to
// Attempt to connect to most recent good host on page load
var urlGivenHost;
window.onload = function() {
    urlGivenHost = getParameterByName("connect");
    var lastGoodHost = getRecentHost();

    if (urlGivenHost) {
        setupSocket(urlGivenHost);
    }
    else if (lastGoodHost) {
        setupSocket(lastGoodHost);
    }
 };

// Query string extraction (credit goes to https://stackoverflow.com/a/901144/8250599)
 function getParameterByName(name, url) {
     if (!url) url = window.location.href;
     name = name.replace(/[\[\]]/g, "\\$&");
     var regex = new RegExp("[?&]" + name + "(=([^&#]*)|&|#|$)"),
         results = regex.exec(url);
     if (!results) return null;
     if (!results[2]) return '';
     return decodeURIComponent(results[2].replace(/\+/g, " "));
 }

// Setup autocomplete for the host field
 new autoComplete({
     selector: '#host-field',
     minChars: 0,
     delay: 200,
     cache: false,
     source: function(input, suggest){
         input = input.toLowerCase();
         var choices = getGoodHostRecords();
         suggest(choices.filter(function(entry){
             return ~entry.host.toLowerCase().indexOf(input)
         }));
     },

     // record: { host: hostname, date: date of most recent connection}
     renderItem: function (record, input){
        input = input.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        var re = new RegExp("(" + input.split(' ').join('|') + ")", "gi");
        return '<div class="autocomplete-suggestion" data-val="' + record.host + '">' + record.host.replace(re, "<b>$1</b>")
                + '<div class="moment-ago">'+moment(record.date).fromNow()+'</div></div>';
    }
 });

// HTML String Formatters
function iStr(str) { return "<i>" + str + "</i>" }
function bStr(str) { return "<b>" + str + "</b>" }

alertify.logPosition("bottom right");


//----Log-----
var logContainer = document.getElementById("log");
var logEntries = document.getElementById("log-entries");
var logUpdateInterval;

function clearLogEntries() {
    logEntries.innerHTML = "";
}

function showLog() {
    logContainer.style.display = 'block';
    logUpdateInterval = setInterval(updateLogTimestamps, 5000);
}

function hideLog() {
    logContainer.style.display = 'none';
    clearInterval(logUpdateInterval);
}

function createLogEntry(msg) {
    var now = new Date();
    var newEntry = '<div class="log-entry" data-time="'+now+'">'
                        + timestampDiv(now)
                        + '<div class="entry-text">' + msg + '</div>'
                    + '</div>';
    logEntries.innerHTML = newEntry + logEntries.innerHTML;
}

function timestampDiv(time) { return '<div class="timestamp">'+moment(time).fromNow()+'</div>'}

function updateLogTimestamps() {
    logEntries.childNodes.forEach(function(entry) {
            var time = entry.dataset.time;
            entry.firstChild.innerHTML = moment(time).fromNow();
    })
}



///////////////////////////////////////////////////
//                  WebSocket                    //
///////////////////////////////////////////////////

var socket;
var host;
var state;
var stateMap = {
    0 : "Not Connected.",
    1 : "Connecting.",
    2 : "Connected.",
    3 : "Error Connecting.",
    4 : "Socket Closed."
};
setState(0);

function setupSocket(tryhost){

    setState(1);

    host = tryhost;
    socket = new WebSocket("ws://" + host);

    socket.onopen = function(event) {
        console.log("Connected to server.");
        setState(2);
        sendOSC("HELO");
    };

    socket.onmessage = function(event) {
        var osc = JSON.parse(event.data);
        var msgAction = getOscAddr(osc);

        if (msgAction != "TEST") {
            console.log("Received:", osc)
        }

        var msgFnc = msgcFuncs[msgAction];
        msgFnc(osc);
    };

    socket.onclose = function(event) {
        console.log("Socket Closed.", event);
        setState(4);
    };

    socket.onerror = function(event) {
        console.log("Socket Error.");
        setState(3);
    };
}



function setState(newState) {
    var prevState = state;
    state = newState;
    if (state == 2) { // Connected
        successfulConnect()
    }
    else if (prevState == 1 && state > 2 ) { // failed attempt to connect
        failedConnect();
    }
    else if (state > 2  && prevState == 2) { // connection closed
        successfulDisconnect();
    }
}

function successfulConnect() {
    hostField.value = host;             // on Safari the field needs this for
    hostField.style.display = 'none';   // redraw or the placeholder sticks
    hostField.style.display = 'block';

    if (host == urlGivenHost) {
        alertify.success("Auto-connected to host: " + bStr(host));
    }
    else if (host == getRecentHost()) {
        alertify.success("Connected to last known host: " + bStr(host));
    }
    else {
        alertify.success("Connected to " + bStr(host));
    }
    saveGoodHost(host);
    createGUI();
}

function successfulDisconnect() {
    alertify.error(stateMap[state]);
    destroyGUI();
    clearLogEntries();
}

function failedConnect() {
    var recent = getRecentHost();
    if (host == getRecentHost()) {
        alertify.error("Connection to last good host failed.");
        hostField.value = "";
    }
    else {
        alertify.error("Could not connect: " + stateMap[state]);
    }
    recordHostFailure(host);
    removeBadHosts();
    hostField.focus();
}

// Local Storage Helpers
//---------------------

// Create a record of a good host in localStorage
function saveGoodHost(hostname) {
    var goodHosts = getGoodHostRecords() || [];
    goodHosts = goodHosts.filter(function(prevEntry) { return prevEntry.host != hostname })
    var entry = {
        "host" : hostname,
        "date" : new Date(),
        "failures" : 0
    }
    goodHosts.unshift(entry);
    localStorage.setItem('goodHosts', JSON.stringify(goodHosts));
}

// Erase the record of a known host from localStorage
function eraseGoodHost(hostname) {
    var goodHosts = getGoodHostRecords().filter(function(prevEntry) { return prevEntry.host != hostname })
    localStorage.setItem('goodHosts', JSON.stringify(goodHosts));
}

// Increment the failure count of a host record
function recordHostFailure(hostname) {
    var hosts = getGoodHostRecords()
    hosts.forEach(function(record){
        if (record.host == hostname) {
            record.failures++
        }
    })
    localStorage.setItem('goodHosts', JSON.stringify(hosts));
}

// Remove records of hosts with high failure counts
function removeBadHosts() {
    goodHosts = getGoodHostRecords().filter(function(prevEntry) { return prevEntry.failures < 5 })
    localStorage.setItem('goodHosts', JSON.stringify(goodHosts));
}

// Returns list of hosts successfully connected to where entries are:
//        {
//            host: hostname,
//            date: date of last successful connection,
//            failures: count of failed connections since last successful
//        }
function getGoodHostRecords() {
    var storedString = localStorage['goodHosts'];
    if (typeof storedString === 'undefined') storedString = '[]';
    var goodHosts = JSON.parse(storedString);
    return goodHosts;
}

// Returns a list of good hostnames only
function getGoodHosts() {
    return getGoodHostRecords().map(function(entry){ return entry.host });
}

// Returns the name of last host connected to
function getRecentHost() {
    return getGoodHosts()[0];
}

function getRecentHostRecord() {
    return getGoodHostRecords()[0];
}


///////////////////////////////////////////////////
//                   Dat.GUI                     //
///////////////////////////////////////////////////
var paramVals  = {}; // need to store these
var paramMetas = {}; // separately for dat.GUI
var groups = [];     // list of dat.gui folders for param groups
var presetFolder;


var guiContainer = document.getElementById('controls');
var placeholderControls = document.getElementById('controls-placeholder');
var gui;

function createGUI() {
   placeholderControls.style.display = 'none';
   gui = new dat.GUI({ autoPlace: false, width: guiContainer.offsetWidth - 10 });
   window.addEventListener("resize", function() {
       gui.width = guiContainer.offsetWidth;
   })
   guiContainer.insertBefore(gui.domElement, logContainer);
   showLog();
   presetFolder = new PresetFolder(gui);

}


function destroyGUI(){
    if (gui) {
        gui.destroy();
        guiContainer.removeChild(gui.domElement);
    }
    paramVals = {};
    paramMetas = {};
    groups = [];
    hideLog();
    placeholderControls.style.display = 'block';
}

///////////////////////////////////////////////////
//                    Presets                    //
///////////////////////////////////////////////////

function PresetFolder(guiRef, groupName, rgbac) {
    var NO_SELECTION = "No Preset Selected";
    var isMain = (typeof groupName === 'undefined');

    this.presetFolder = guiRef.addFolder(isMain ? "Presets" : "Group Presets");
    this.presetFolder.open();
    this.presetNames = [NO_SELECTION];

    this.groupName = (isMain) ? "" : groupName;
    this.sendSET = (isMain) ? sendSETP : function(pName) { sendSETp(pName, groupName) };
    this.sendSAV = (isMain) ? sendSAVP : function(pName) { sendSAVp(pName, groupName) };
    this.sendDEL = (isMain) ? sendDELP : function(pName) { sendDELp(pName, groupName) };

    //----Perform Styling that cant be done in CSS----
    var folderUL = this.presetFolder.domElement.firstChild;
    folderUL.style.display = 'flex';
    folderUL.style.flexWrap = 'wrap';

    var header = this.presetFolder.domElement.firstChild.firstChild;
    header.style.width = "100%";

    // lighter color for group preset headers
    if (!isMain) header.style.backgroundColor = rgbac; //"#1c1c1c";

    // Redraws the Preset folder
    this.redrawPresetFolder = function(){

        for (var i = this.presetFolder.__controllers.length - 1; i >= 0; i--) {
            this.presetFolder.__controllers[i].remove();
        }

        if (isMain) {
            this.presetFolder.add(this, "Load Code Defaults");
            this.presetFolder.add(this, "Load Last XML");
        }

        this.presetFolder.add(this, "Selected Preset", this.presetNames)
                .onFinishChange(this.sendSET);
        this.presetFolder.add(this, "Create New");

        if (this.selectedPreset() !== NO_SELECTION) {
            this.presetFolder.add(this, "Update Current");
            this.presetFolder.add(this, "Delete Current");
        }

        folderUL.childNodes.forEach(function(item){
            item.style.flexGrow = "1";
            item.style.minWidth = "60px";
            item.style.whiteSpace = "nowrap";
            item.style.textAlign = "center";
            if (item.className != "title"){
                var content = item.firstChild;
                if (item.classList.contains("function")){
                    var content = content.firstChild;
                }
                content.style.width = "calc(100% - 4px)";
            }
        })
    }

    // Function linked to a button to create a new preset and send it to the server
    this.createPreset = function() {
        var presetName;
        while (true) {
            presetName = prompt("Name this preset:", "Preset " + this.presetNames.length);
            if (this.presetNames.includes(presetName)) {
                alert("There is already a preset with this name.\nPlease choose a different one.");
            }
            else if (presetName == null || presetName == "") {
                return; // No input, cancel
            }
            else {
                break;
            }
        }
        this.presetNames.push(presetName);
        this.selectedPreset(presetName);
        this.redrawPresetFolder();
        this.sendSAV(presetName);
    }

    // To be called when the user selects a new preset from the dropdown.
    // We want to tell the server a new one was chosen
    this.updatePreset = function() {
        var selectedP = this.selectedPreset();
        if (selectedP == NO_SELECTION) {
            this.createPreset();
        }
        else {
            this.sendSAV(selectedP);
        }
    }

    this.deletePreset = function() {
        var selectedP = this.selectedPreset();
        if (selectedP == NO_SELECTION) {
            console.error("Trying to delete non-existent preset");
        }
        else {
            this.sendDEL(selectedP);
            var toErase = this.presetNames.indexOf(selectedP);
            if (toErase === -1)
                console.error("Trying to delete non-existent preset");
            else {
                this.presetNames.splice(toErase, 1);
                this.selectedPreset(NO_SELECTION);
                this.redrawPresetFolder();
            }
        }
    }


    // Properties/functions to be controlled by dat.GUI
    this["Create New"] = this.createPreset;
    this["Update Current"] = this.updatePreset;
    this["Delete Current"] = this.deletePreset;
    this["Selected Preset"] = NO_SELECTION;

    if (isMain) {
        this["Load Last XML"] = function(){sendRESX()};
        this["Load Code Defaults"] = function(){sendRESD()};
    }

    // convenient getter/setter bc of annoying key
    this.selectedPreset = function(sP) {
         if (typeof sP !== 'undefined') this["Selected Preset"] = sP;
         return this["Selected Preset"]
     };

     // -- Public Function --
     // Call to update with a new preset list
     this.gotPresetList = function(pNames) {
         if (pNames.length && pNames[0] != "NO_PRESETS_SAVED") {
             this.presetNames = [NO_SELECTION].concat(pNames);
             this.redrawPresetFolder();
         }
     }

     // Draw the GUI for the first time to finish initialization
    this.redrawPresetFolder();
}

// Make groups that don't match a search less visible
function filterGroups(str) {
    if (!gui) return;
    var search = new RegExp("(" + str.split(' ').join('|') + ")", "gi");

    Object.keys(gui.__folders).forEach(function(groupName){ // Iterate through groups (names)
        if (groupName == 'Presets') return;
        var group = gui.__folders[groupName];

        // Filter individual param controllers
        var anyParamVisible = false; //see if any params in the group match the search str
        group.__controllers.forEach(function(controller){		            
            var pname = controller.property;
            //controller.__li.style.opacity = pname.match(search) ? '1' : '0.2';
            var stringMatch = pname.match(search);
            anyParamVisible |= (stringMatch != null);
            controller.__li.style.display = stringMatch ? "" : "none" ;
        })

        // Filter group headings if any param in the group matches
        if(anyParamVisible){
            //group.domElement.firstChild.firstChild.style.opacity = '1';
            //group.__folders["group presets"].domElement.style.opacity = '1';
            group.__ul.style.display = "";
        }else {
            //group.domElement.firstChild.firstChild.style.opacity = '0.25';
            //group.__folders["group presets"].domElement.style.opacity = '0.25';
            group.__ul.style.display = "none";
        }
        
    })
}


///////////////////////////////////////////////////
//                Quasi-Osc Things               //
///////////////////////////////////////////////////

function createOsc(addr, args) {
    return {
        "addr": "/" + addr,
        "args": args
    };
}

function sendOSC(addr, args) {
    socket.send(JSON.stringify(createOsc(addr, args)));
}

// Assuming OSC Message arrive in this format:
// {
//    addr: "/ADDR some other info"
//    args: "the data"
// }
// Return the "ADDR"
function getOscAddr(osc) {
    return osc.addr.substr(1,4);
}

// The address of OSC messages sometimes contains space delimited info
function getHeaderPieces(osc) {
    return osc.addr.split(' ');
}

// RGBA color values are the last 4 elts of param OSC message args
function getColorFromArgs(args) {
    var back = args.length - 2;
    return {
        r : args[back - 4],
        g : args[back - 3],
        b : args[back - 2],
        a : args[back - 1]
    }
}

// Update this client's copy of the param values
function setLocalParamViaOsc(osc, type, name) {

	//console.log("_________param name: " + name);
    if (typeof type === 'undefined') type = getHeaderPieces(osc)[1];
    if (typeof name === 'undefined') name = getHeaderPieces(osc)[2];

    var args = osc.args;
    var paramVal = args[0];
    var paramInfo = { "type" : type, "osc" : osc  };
    var groupName = args[args.length - 2];
    var guiRef = gui.__folders[groupName];

    var color = getColorFromArgs(osc.args);
    var control;
    var isNewParam = !(paramVals.hasOwnProperty(name));    

    paramMetas[name] = paramInfo;

    if (type == "FLT") { // [val min max bgR bgG bgB bgA groupName paramDesc]
        paramVals[name] = parseFloat(paramVal);
        paramInfo.min = parseFloat(args[1]);
        paramInfo.max = parseFloat(args[2]);
        if (isNewParam){
        	var step = (paramInfo.max - paramInfo.min) / 1000.0;
            control = guiRef.add(paramVals, name, paramInfo.min, paramInfo.max).step(step);//.listen();
        }
    }
    else if (type == "INT") { // [val min max bgR bgG bgB bgA groupName paramDesc]
        paramVals[name] = parseInt(paramVal);
        paramInfo.min = parseInt(args[1]);
        paramInfo.max = parseInt(args[2]);

        if (isNewParam)
            control = guiRef.add(paramVals, name, paramInfo.min, paramInfo.max).step(1);
    }
    else if (type == "BOL") { // [val bgR bgG bgB bgA groupName paramDesc]
        paramVals[name] = (paramVal == 0) ? false : true; // force true or false
        if (isNewParam)
            control = guiRef.add(paramVals, name);
    }
    else if (type == "STR") { // [val bgR bgG bgB bgA groupName paramDesc]
        paramVals[name] = paramVal;
        if (isNewParam)
            control = guiRef.add(paramVals, name);
    }
    else if (type == "ENU") { // [val min max bgR bgG bgB bgA groupName paramDesc]
        paramVals[name] = parseInt(paramVal);
        var enumMin = parseInt(args[1]);
        var enumMax = parseInt(args[2]);
        var enumMap = {};
        for (var i = enumMin; i <= enumMax; i++) {
            var enumName = args[3 + i - enumMin];
            enumMap[enumName] = i;
        }
        paramInfo.enumMap = enumMap;
        if (isNewParam)
            control = guiRef.add(paramVals, name, paramInfo.enumMap);
    }
    else if (type == "COL") { // [r g b a a bgR bgG bgB bgA groupName paramDesc]
        var alpha =  parseFloat((parseInt(args[3]) / 255).toFixed(3));
        paramVals[name] = [parseInt(args[0]), parseInt(args[1]), parseInt(args[2]), alpha]
        if (isNewParam)
            control = guiRef.addColor(paramVals, name);
    }

    if (control) {
        control.onChange(createParamSend(name));
        var rgbac = 'rgba(' + color.r + ',' + color.g + ',' + color.b + ',0.3)';
        control.__li.style.borderLeft = '10px solid ' + rgbac;
        control.__li.style.backgroundColor = rgbac;
    }

    if (!isNewParam) gui.updateDisplay();
}

function requestRemoteParams() { sendOSC("REQU"); }

/* Possible osc addresses: (see ofxRemoteUI.h)
HELO    –   In Response to client HELO
REQU    –   'REQU OK' indicates end of requested param lists
SEND    –   Followed by a param
PREL    –   Preset name list
SETP    -   Followed by OK, server set preset ack
MISP    -   Missing presets
SAVP    –   Save current params as preset
DELP    -   Delete a preset
RESX    -   Reset to default XML values
RESD    –   Reset to code defaults (pre-RUI invocation)
SAVp    -   Save a group preset
DELp    -   Delete a group preset
TEST    -   Part of ping-pong keep alive exchange
CIAO    -   Signal disconnect
*/

// Server sends HELO after we say HELO, opening connection
// Next we want to request the param list
function gotHELO(osc) {
    setInterval(function() {sendOSC("TEST")}, 3000);
    sendOSC("REQU");
}

// Should receive a message like { addr : "/REQU OK"} to signal end of param transmission
function gotREQU(osc) {
    var headerPieces = osc.addr.split(' ');
    if (headerPieces.length == 2 || headerPieces[1] == "OK") {
        // Great, we got all the params
    }
    else {
        // UH-OH
    }
}

// Got TEST, keep alive
function gotTEST(osc) {
    // we'll send our own TEST separately
}

function gotSEND(osc) {
    var headerPieces = getHeaderPieces(osc);
    var type = headerPieces[1];
    var name = headerPieces[2]; //fetch param/group name, it may have spaces so let keep parsing...
    if(headerPieces.length > 3){
    	var c = 3;
    	while(c < headerPieces.length){
    		name += " " + headerPieces[c];
    		c++;
    	}
    }

    if (type == "SPA" && !gui.__folders[name]) { // Its a new group
    	console.log("#### " + name + "############################");
        var newGroup = gui.addFolder(name);
        newGroup.domElement.classList.add("param-group");
        var headerStyle = newGroup.domElement.firstChild.firstChild.style;
        headerStyle.fontSize = "1.2em";
        headerStyle.height = "29px";
        headerStyle.lineHeight = "29px";
        headerStyle.textAlign = "center";
        headerStyle.marginTop = "10px";
        newGroup.open();

   		var color = getColorFromArgs(osc.args);
        var rgbac = 'rgba(' + color.r + ',' + color.g + ',' + color.b + ',0.5)';
        headerStyle.backgroundColor = rgbac;

		var rgbac2 = 'rgba(' + color.r + ',' + color.g + ',' + color.b + ',0.3)';
        newGroup.presetFolder = new PresetFolder(newGroup, name, rgbac2);
        newGroup.presetFolder.presetFolder.close();

        //newGroup.close();
        groups.unshift(newGroup);
    }
    else {
        setLocalParamViaOsc(osc, type, name);
    }
}

function gotPREL(osc) {
    var args = osc.args;
    var groupPresets = {};

    var globalPresets = args.filter(function(pName){
        var slashPos = pName.indexOf('/');
        if (slashPos == -1)
            return true;

        var groupName = pName.substr(0, slashPos);
        if (!groupPresets[groupName]) groupPresets[groupName] = [];
        groupPresets[groupName].push(pName.substr(slashPos + 1)); // push group preset name after '/'
        return false;
    });

    presetFolder.gotPresetList(globalPresets);

    Object.keys(groupPresets).forEach(function(groupName) {
        if (gui.__folders[groupName])
            gui.__folders[groupName].presetFolder.gotPresetList(groupPresets[groupName]);
    })

}

function gotSETP(osc) {
    requestRemoteParams();
    alertify.success("Loaded " + bStr(osc.args[0]));
}
function gotSETp(osc) {
    requestRemoteParams();
    alertify.success(bStr(osc.args[1])
        + " group loaded " + bStr(osc.args[0]))
}

function gotSAVP(osc) {
    alertify.success("Saved " + bStr(osc.args[0]));
}

function gotSAVp(osc){
    alertify.success("Saved " + bStr(osc.args[0]) + " for " + bStr(osc.args[1]));
}

function gotRESX(osc) {
    alertify.success("Loaded last saved XML");
    requestRemoteParams();
}

function gotRESD(osc) {
    alertify.success("Loaded code defaults");
    requestRemoteParams();
}

function gotCIAO(osc) {
    alertify.log("Server says CIAO");
}

function gotDELP(osc) {
    alertify.error("Deleted " + bStr(osc.args[0]) + " preset")
}

function gotDELp(osc) {
    alertify.error("Deleted " + bStr(osc.args[0])
        + " from " + bStr(osc.args[1]));
}

function gotMISP(osc) {
    var listStr = osc.args.reduce(function(acc, param, i, list) {
            var bParam = bStr(param);
            acc += (i == list.length-1) ? bParam : bParam + ', '
            return acc
    }, "")
    alertify.error("Missing params: " + listStr);
}

function gotLOG_(osc) {
    var msg = osc.args[0];
    alertify.log(bStr("Log: ") + msg);
    createLogEntry(msg);
}

var msgcFuncs = {
    "HELO" : gotHELO,
    "REQU" : gotREQU,
    "SEND" : gotSEND,
    "PREL" : gotPREL,
    "SETP" : gotSETP,
    "SETp" : gotSETp,
    "SAVP" : gotSAVP,
    "SAVp" : gotSAVp,
    "MISP" : gotMISP,
    "DELP" : gotDELP,
    "RESX" : gotRESX,
    "RESD" : gotRESD,
    "DELp" : gotDELp,
    "TEST" : gotTEST,
    "CIAO" : gotCIAO,
    "LOG_" : gotLOG_
}


// Save a global preset
function sendSAVP(newName) {
    sendOSC("SAVP",[newName]);
}

// Save a group preset
function sendSAVp(presetName, groupName) {
    sendOSC("SAVp", [presetName, groupName]);
}

// Set a global preset
function sendSETP(presetName) {
    sendOSC("SETP", [presetName]);
}

function sendDELP(presetName) {
    sendOSC("DELP", [presetName]);
}

// Set a group preset
function sendSETp(presetName, groupName) {
    sendOSC("SETp", [presetName, groupName]);
}

function sendDELp(presetName, groupName) {
    sendOSC("DELp", [presetName, groupName]);
}

function sendRESD() {
    sendOSC("RESD");
}

function sendRESX() {
    sendOSC("RESX");
}

// Manufacture a function that is used to update parameters on the server
function createParamSend(name){
    return function(val) {
        if (paramMetas[name].type == "ENU") val = parseInt(val);
        if (paramMetas[name].type == "BOL") val = val ? 1 : 0;
        paramMetas[name].osc.args[0] = val;
        if (paramMetas[name].type == "COL"){
            if (typeof val === 'string') val = JSON.parse(val)
            paramMetas[name].osc.args[0] = val[0];
            paramMetas[name].osc.args[1] = val[1];
            paramMetas[name].osc.args[2] = val[2];
            paramMetas[name].osc.args[3] = val[3] * 255;
        }
        socket.send(JSON.stringify(paramMetas[name].osc));
    }
}
